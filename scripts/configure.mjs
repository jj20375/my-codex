/** @file 只在首次安裝產生本機環境設定；既有 .env 不覆寫，避免輪替後失去資料庫存取。 */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
/** 從腳本位置定位專案，支援直接執行與 Docker 掛載執行。 */
const root = resolve(import.meta.dirname, '..');
try { await access(resolve(root, '.env')); console.log('已保留既有 .env'); }
catch {
  /** 每台安裝產生不同秘密，不使用示範密碼。 */
  let content = await readFile(resolve(root, '.env.example'), 'utf8');
  for (const key of ['DB_PASSWORD', 'DB_ROOT_PASSWORD', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'RUNNER_SECRET']) content = content.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('base64url')}`);
  await writeFile(resolve(root, '.env'), content, { flag: 'wx', mode: 0o600 });
  console.log('已建立 .env。工作空間密碼保存在 ADMIN_PASSWORD；請自行查看並妥善保存。');
}
await mkdir(resolve(root, '.runtime'), { recursive: true, mode: 0o700 });
/** 新增功能只補上缺少的金鑰，不變更既有登入或 DB 憑證。 */
const envPath = resolve(root, '.env');
let existing = await readFile(envPath, 'utf8');
if (!/^LOCAL_FILES_SECRET=.+$/m.test(existing)) {
  existing = existing.replace(/^LOCAL_FILES_SECRET=.*\r?\n?/m, '');
  await writeFile(envPath, existing + `\nLOCAL_FILES_SECRET=${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
}
