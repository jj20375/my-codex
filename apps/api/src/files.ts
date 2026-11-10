/** @file 驗證附件內容簽章並存入持久 volume；工作區下載必須通過真實路徑檢查，禁止跨 session 與符號連結逃逸。 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { open, rename, unlink, realpath, readdir, stat, readFile } from 'node:fs/promises';
import { extname, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { config } from './config';
import { Attachment } from './db';
/** 每個附件最多 20 MiB，每次最多十個。 */
export const maxFileSize = 20 * 1024 * 1024;
/** Legacy Office 交給容器內 LibreOffice，Open XML 可直接用 Python。 */
export const extensions = new Set(['.pdf', '.xlsx', '.xls', '.pptx', '.ppt', '.docx', '.doc', '.csv', '.jpg', '.jpeg', '.png']);
/** 檔名只供顯示，不參與路徑組合；同時驗證副檔名及內容標頭。 @param input 檔名與標頭。 @returns 是否符合類型。 */
export function validSignature({ name, header }: { name: string; header: Buffer }): boolean {
  /** 使用白名單副檔名選擇必要內容簽章。 */
  const extension = extname(name).toLowerCase();
  if (extension === '.pdf') return header.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.png') return header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (['.jpg', '.jpeg'].includes(extension)) return header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (['.xlsx', '.pptx', '.docx'].includes(extension)) return header.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  if (['.xls', '.ppt', '.doc'].includes(extension)) return header.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (extension === '.csv') return true;
  return false;
}
/** 修正瀏覽器 multipart UTF-8 檔名被預設 Latin-1 解讀的情況。 @param name parser 檔名。 @returns 顯示檔名。 */
function displayName(name: string) {
  /** 已是 Unicode 的來源不再次轉碼。 */
  const bytes = Buffer.from(name, 'latin1');
  return basename([...name].some(character => character.charCodeAt(0) > 255) || !isUtf8(bytes) ? name : bytes.toString('utf8')).replace(/[\x00-\x1f]/g, '').slice(0, 255);
}
/** 全批附件先驗證再建立資料列；失敗時刪除暫存與已移動的檔案。 @param files Multer 暫存附件。 @returns 已保存附件列表。 */
export async function saveAttachments(files: Express.Multer.File[]) {
  if (!files.length || files.length > 10) throw new BadRequestException('每次請選擇 1–10 個檔案');
  /** 所有本次新增路徑都在失敗時清理，不碰既有附件。 */
  const created: string[] = [];
  try {
    for (const file of files) {
      /** 只讀必要的前八位元組，避免把全部附件載入記憶體。 */
      const descriptor = await open(file.path, 'r');
      /** 每個支援格式都至少有 4–8 bytes 的 magic header。 */
      const header = Buffer.alloc(8);
      try { await descriptor.read(header, 0, 8, 0); } finally { await descriptor.close(); }
      const csv = extname(file.originalname).toLowerCase() === '.csv' ? await readFile(file.path) : null;
      if (!file.size || !validSignature({ name: file.originalname, header }) || csv && (csv.includes(0) || !isUtf8(csv))) throw new BadRequestException('檔案類型與內容不符，請使用 PDF、Excel、CSV、Word、PPT、JPG 或 PNG');
    }
    /** 資料列失敗亦會回滾本批檔案。 */
    const records: Array<{ id: string; name: string; extension: string; size: number }> = [];
    for (const file of files) {
      /** 隨機 UUID 阻擋路徑穿越與同名覆寫。 */
      const id = randomUUID();
      /** 上傳端不可決定實際儲存名稱。 */
      const extension = extname(file.originalname).toLowerCase();
      /** UUID 和白名單副檔名皆由伺服器控制。 */
      const destination = resolve(config.UPLOAD_DIR, id + extension);
      await rename(file.path, destination);
      created.push(destination);
      records.push({ id, name: displayName(file.originalname), extension, size: file.size });
    }
    return await Attachment.bulkCreate(records);
  } catch (error) {
    await Promise.all([...files.map(file => file.path), ...created].map(path => unlink(path).catch(() => undefined)));
    throw error;
  }
}
/** 確認檔案實體位於同一 session 工作區內，包含符號連結的目標檢查。 @param input session ID 與相對路徑。 @returns 實體檔案路徑。 */
export async function artifactPath({ sessionId, relative }: { sessionId: string; relative: string }) {
  try {
    /** 只接受相對路徑，真實 root 固定由 session 決定。 */
    const root = await realpath(resolve(config.WORKSPACE_DIR, sessionId));
    /** realpath 會解析所有中間符號連結。 */
    const target = await realpath(resolve(root, relative));
    if (!target.startsWith(root + sep) || !(await stat(target)).isFile()) throw new Error('Invalid path');
    return target;
  } catch { throw new NotFoundException('找不到可下載檔案'); }
}
/** 僅列出一般檔案，不跟隨符號連結；限制深度與數量避免巨大目錄拖慢聊天。 @param sessionId session ID。 @returns 相對路徑清單。 */
export async function artifacts(sessionId: string) {
  /** UI 只取得相對路徑，完整實體路徑不對外公開。 */
  const result: Array<{ path: string; size: number }> = [];
  /** 固定根目錄隔離其他 session。 */
  const root = resolve(config.WORKSPACE_DIR, sessionId);
  async function walk({ directory, prefix, depth }: { directory: string; prefix: string; depth: number }): Promise<void> {
    if (depth > 4 || result.length >= 200) return;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || result.length >= 200) continue;
      /** 目錄列舉本身不跟隨 symlink，下載時仍再次 realpath 驗證。 */
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk({ directory: resolve(directory, entry.name), prefix: path + '/', depth: depth + 1 });
      else if (entry.isFile()) result.push({ path, size: (await stat(resolve(directory, entry.name))).size });
    }
  }
  await walk({ directory: root, prefix: '', depth: 0 });
  return result;
}
/** 只讀取有限大小的 UTF-8 原始碼，二進位與大型檔案改用下載。 @param input 工作區及相對檔名。 @returns 安全文字。 */
export async function artifactContent({ sessionId, relative }: { sessionId: string; relative: string }) {
  const target = await artifactPath({ sessionId, relative });
  const file = await open(target, 'r');
  try {
    if ((await file.stat()).size > 1024 * 1024) throw new BadRequestException('文字預覽上限為 1 MB，請下載檔案查看');
    const content = await file.readFile();
    if (!isUtf8(content) || content.includes(0)) throw new BadRequestException('此檔案無法以文字預覽，請下載查看');
    return { text: content.toString('utf8'), extension: extname(target).toLowerCase(), modifiedAt: (await file.stat()).mtimeMs };
  } finally { await file.close(); }
}
