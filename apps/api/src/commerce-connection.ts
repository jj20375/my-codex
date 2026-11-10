/** @file 電商連線的伺服器密文保存與限定 API 傳輸；憑證不提供給前端或模型。 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BadRequestException, BadGatewayException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { config } from './config';
/** 只接受本機安裝或 HTTPS 服務；拒絕帳密 URL、query、fragment 與 metadata 位址。 */
export function connectionUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname;
  const local =
    host === 'localhost' ||
    host === 'host.docker.internal' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && local))
  )
    throw new BadRequestException('連線位址須為本機 HTTP 或 HTTPS，且不能含帳密、query 或 fragment');
  return url.href.replace(/\/$/, '');
}
export const providerSchema = z.enum(['cobuy', 'socai']);
export const connectionInput = z
  .object({
    baseUrl: z.string().url().max(1000),
    mediaUrl: z.string().url().max(1000).optional(),
    token: z
      .string()
      .min(16)
      .max(16000)
      .regex(/^[A-Za-z0-9_.-]+$/),
    scopeId: z.number().int().positive(),
  })
  .strict();
/** 每個系統只有一條明確授權的連線；改來源時產生新身分。 */
export interface Connection {
  /** 服務身分。 */ id: string;
  /** 固定 API 基址。 */ baseUrl: string;
  /** coBuy 媒體服務。 */ mediaUrl?: string;
  /** 遠端登入 JWT。 */ token: string;
  /** 店別或工作區。 */ scopeId: number;
}
/** 以 SESSION_SECRET 派生專用金鑰；包含服務名稱 AAD，防止密文挪到另一服務。 */
export function sealConnection(input: { value: unknown; secret: string; provider: string }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256')
      .update('commerce:' + input.secret)
      .digest(),
    iv,
  );
  cipher.setAAD(Buffer.from(input.provider));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(input.value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map((value) => value.toString('base64')).join('.');
}
/** 解密失敗時要求重新連線，不將密文或秘密顯示於錯誤。 */
export function openConnection(input: { value: string; secret: string; provider: string }) {
  const [iv, tag, bytes] = input.value.split('.').map((value) => Buffer.from(value, 'base64'));
  const cipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256')
      .update('commerce:' + input.secret)
      .digest(),
    iv,
  );
  cipher.setAAD(Buffer.from(input.provider));
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(bytes), cipher.final()]).toString()) as Connection;
}
/** 僅從固定持久目錄存取；key 由應用程式產生，不接受路徑。 */
function storagePath(key: string) {
  if (!/^[a-z0-9-]+$/.test(key)) throw new BadRequestException('無效記錄');
  return resolve(config.DATA_DIR, 'commerce-connections', key + '.json');
}
/** 原子取代狀態，避免中斷留下半個 JSON。 */
export async function writeRecord(input: { key: string; value: unknown }) {
  await mkdir(resolve(config.DATA_DIR, 'commerce-connections'), { recursive: true, mode: 0o700 });
  const temporary = storagePath(input.key) + '-' + randomUUID();
  try {
    await writeFile(temporary, JSON.stringify(input.value), { mode: 0o600 });
    await rename(temporary, storagePath(input.key));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
/** 不存在與損壞分開處理；損壞不得當作可重新送出的空記錄。 */
export async function readRecord<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(storagePath(key), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ConflictException('連線或傳送記錄無法讀取，請檢查本機持久資料');
  }
}
/** 回傳已解密的指定服務設定；僅供伺服器使用。 */
export async function readConnection(provider: string) {
  const saved = await readRecord<string>('connection-' + provider);
  if (!saved) throw new BadRequestException('請先至系統連線設定 ' + provider);
  try {
    return openConnection({ value: saved, secret: config.SESSION_SECRET, provider });
  } catch {
    throw new BadRequestException('連線憑證無法解密，請重新連線');
  }
}
/** 有界讀取避免遠端錯誤或大型回應耗盡記憶體。 */
export async function responseBytes(input: { response: Response; limit: number }) {
  const reader = input.response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > input.limit) throw new BadGatewayException('遠端回應超出大小限制');
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
/** 單次送出，不自動重送寫入；所有導向拒絕，避免 Authorization 被轉送到其他來源。 */
export async function remoteRequest(input: {
  connection: Connection;
  path: string;
  method?: string;
  body?: unknown;
}) {
  if (!input.path.startsWith('/') || input.path.startsWith('//') || input.path.split('?')[0].includes('..'))
    throw new BadRequestException('無效 API 路徑');
  const form = input.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(input.connection.baseUrl + input.path, {
      method: input.method ?? 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: 'Bearer ' + input.connection.token,
        ...(input.body && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      body:
        input.body === undefined ? undefined : form ? (input.body as FormData) : JSON.stringify(input.body),
    });
  } catch {
    throw new BadGatewayException('遠端連線失敗或逾時；寫入結果可能需要至原系統確認');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new BadRequestException('遠端登入已失效，請重新設定連線憑證');
    if (response.status === 409)
      throw new ConflictException('遠端商品或內容已變更，請重新讀取來源並確認差異');
    throw new BadGatewayException(`遠端拒絕操作（HTTP ${response.status}），請確認帳號權限及服務狀態`);
  }
  try {
    const value = JSON.parse((await responseBytes({ response, limit: 4 * 1024 * 1024 })).toString());
    return value.data ?? value;
  } catch (error) {
    if (error instanceof BadGatewayException) throw error;
    throw new BadGatewayException('遠端回應格式不正確');
  }
}
/** 媒體 token 僅傳到使用者另行設定的固定媒體來源。 */
export function mediaTarget(input: { connection: Connection; url: string }) {
  if (!input.connection.mediaUrl) throw new BadRequestException('請設定 coBuy 媒體服務位址');
  const url = new URL(input.url);
  const base = new URL(input.connection.mediaUrl);
  if (
    base.hostname === 'host.docker.internal' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.port === base.port &&
    url.protocol === base.protocol
  )
    url.hostname = base.hostname;
  if (url.origin !== base.origin || url.username || url.password)
    throw new BadGatewayException('媒體來源與已授權設定不符');
  return url;
}
/** 非 JSON 媒體操作也拒絕重新導向及無界等待。 */
export async function mediaFetch(input: {
  connection: Connection;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer;
}) {
  const url = mediaTarget(input);
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.method ?? 'GET',
      headers: input.headers,
      body: input.body ? new Uint8Array(input.body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new BadGatewayException('媒體服務無法連線或逾時');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new BadGatewayException('媒體服務拒絕操作');
  }
  return response;
}
/** 在建立遠端貼文前持久化唯一標記；中斷後不盲目重送。 */
export async function claimDelivery(key: string) {
  await mkdir(resolve(config.DATA_DIR, 'commerce-connections'), { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      storagePath(key),
      JSON.stringify({ state: 'sending', startedAt: new Date().toISOString() }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ConflictException('此草稿已送出或結果待確認，請查看傳送記錄');
    throw error;
  }
}
