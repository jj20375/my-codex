/** @file 在獨立容器內管理官方 Codex app-server；僅將受驗證的內部 RPC 與事件提供給控制 API。 */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm, readdir, realpath, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { constants, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { timingSafeEqual, randomUUID } from 'node:crypto';

/** 內部共享金鑰，只供 API 與 runner 通訊。 */
const secret = process.env.RUNNER_SECRET;
if (!secret || secret.length < 32) throw new Error('RUNNER_SECRET 至少需要 32 字元');
/** 每個安裝環境有獨立的 Codex 登入與 rollout 儲存目錄。 */
const home = resolve(process.env.CODEX_STATE_DIR ?? '../../.runtime/codex');
/** 所有任務只能在指定持久工作區內操作。 */
const workspace = resolve(process.env.WORKSPACE_DIR ?? '../../.runtime/workspaces');
await mkdir(home, { recursive: true, mode: 0o700 });
await mkdir(workspace, { recursive: true });
/** API 可訂閱事件；事件來源固定為子程序 stdout 的 JSON 訊息。 */
const subscribers = new Set<ServerResponse>();
/** 尚未完成的 RPC，程序結束時全部拒絕以便上層恢復。 */
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
/** 用量快照落盤，API 重啟或串流斷線時不會漏記已完成的 token 事件。 */
const usagePath = resolve(home, 'workspace-usage.json');
let usageSnapshots: Record<string, unknown> = {};
try { usageSnapshots = JSON.parse(readFileSync(usagePath, 'utf8')); } catch { /* 首次安裝尚無快照。 */ }
/** 尚未收到回覆的工具要求在 API 重連時重送；呼叫端以 callId 去重。 */
const toolRequests = new Map<string | number, unknown>();
let sequence = 0;
let child: ChildProcessWithoutNullStreams | undefined;
let ready: Promise<unknown> | undefined;
/** 僅開放本系統需要的協定，阻擋設定、外部憑證注入與任意程序管理。 */
const methods = new Set(['account/read', 'account/login/start', 'account/login/cancel', 'account/logout', 'account/rateLimits/read', 'model/list', 'thread/start', 'thread/resume', 'thread/read', 'turn/start', 'turn/interrupt']);

/** 將協定通知送給 API；心跳與重連由 HTTP 層處理。 @param event 協定事件。 @returns 無。 */
function broadcast(event: unknown) {
  /** 僅保存用量通知，不保存登入 URL 或憑證內容。 */
  const record = event as { method?: string; params?: { threadId?: string } };
  if (record.method === 'thread/tokenUsage/updated' && record.params?.threadId) {
    usageSnapshots[record.params.threadId] = event;
    writeFileSync(usagePath + '.tmp', JSON.stringify(usageSnapshots), { mode: 0o600 });
    renameSync(usagePath + '.tmp', usagePath);
  }
  for (const response of subscribers) response.write(`data: ${JSON.stringify(event)}\n\n`);
}
/** 呼叫 app-server 並處理相符回應與逾時。 @param request 方法及參數。 @returns 原始協定 result。 */
function call({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
  /** RPC id 在同一程序中保持唯一。 */
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    /** 防止沒有回應的 RPC 永久佔住佇列。 */
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex RPC timeout: ${method}`)); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    child?.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + '\n');
  });
}
/** 啟動官方程序；不將 API 或資料庫環境設定傳給 agent。 @returns 初始化完成的 Promise。 */
function start() {
  if (ready) return ready;
  child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"', '-c', 'sandbox_workspace_write.network_access=true'], {
    cwd: workspace,
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: 'C.UTF-8', NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  /** stdout 每行為一則 JSON-RPC 訊息，stderr 不轉送避免曝露本機路徑與設定。 */
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      /** 先解析外部程序訊息，再判斷回應或通知。 */
      const message = JSON.parse(line);
      if (message.id !== undefined && !message.method) {
        /** 只結算仍在等待的 RPC；過期回應可安全忽略。 */
        const waiting = pending.get(message.id);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        pending.delete(message.id);
        if (message.error) waiting.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else waiting.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        if (message.method === 'item/tool/call') { const request = { ...message, method: 'runner/toolCall' }; toolRequests.set(message.id, request); broadcast(request); }
        else {
          /** 第一版不允許 agent 提升沙盒權限；需要互動的操作會清楚回報拒絕。 */
          child?.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: '此安裝不開放沙盒外的操作或互動工具。' } }) + '\n');
          broadcast({ method: 'runner/approvalDenied', params: { method: message.method, threadId: message.params?.threadId } });
        }
      } else broadcast(message);
    } catch { broadcast({ method: 'runner/protocolError', params: {} }); }
  });
  child.stderr.resume();
  child.on('error', () => lost());
  child.on('exit', () => lost());
  ready = call({ method: 'initialize', params: { clientInfo: { name: 'personal_codex_workspace', title: 'Codex Workspace', version: '0.1.0' }, capabilities: { experimentalApi: true } } })
    .then(result => { child?.stdin.write('{"method":"initialized"}\n'); return result; });
  return ready;
}
/** 子程序故障後清除等待，允許下一個請求啟動新程序。 @returns 無。 */
function lost() {
  ready = undefined;
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Codex process disconnected')); }
  pending.clear();
  toolRequests.clear();
  broadcast({ method: 'runner/disconnected', params: {} });
}
/** 固定時間驗證內部金鑰，避免比較長度或時序洩漏。 @param token 請求金鑰。 @returns 是否相符。 */
function authorized(token: string | string[] | undefined) {
  return typeof token === 'string' && Buffer.byteLength(token) === Buffer.byteLength(secret!) && timingSafeEqual(Buffer.from(token), Buffer.from(secret!));
}
/** HTTP 只在容器私有網路可見；本機開發預設綁定 loopback。 */
const server = createServer(async (request, response) => {
  if (request.url === '/health') { response.end('ok'); return; }
  if (!authorized(request.headers['x-runner-secret'])) { response.writeHead(401).end(); return; }
  if (request.url === '/events' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    response.write('data: {"method":"runner/connected","params":{}}\n\n');
    for (const event of Object.values(usageSnapshots)) response.write(`data: ${JSON.stringify(event)}\n\n`);
    for (const event of toolRequests.values()) response.write(`data: ${JSON.stringify(event)}\n\n`);
    subscribers.add(response);
    /** 中介代理不應把空閒事件串流判定為逾時。 */
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
    request.on('close', () => { clearInterval(heartbeat); subscribers.delete(response); });
    return;
  }
  try {
    if (!['/rpc','/local-file'].includes(request.url ?? '') || request.method !== 'POST') { response.writeHead(404).end(); return; }
    /** 請求有大小上限，避免內部錯誤耗盡記憶體。 */
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > (request.url === '/local-file' ? 30_000_000 : 2_000_000)) throw new Error('RPC payload too large');
      chunks.push(chunk);
    }
    /** API 負責業務參數驗證；runner 另限制可用方法與工作目錄。 */
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === '/local-file') {
      const { sessionId, name, data } = body.params ?? {};
      if (body.method !== 'runner/localFile' || typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId) || typeof name !== 'string' || typeof data !== 'string') throw new Error('Invalid local file');
      const root = resolve(workspace, sessionId);
      await mkdir(root, { recursive: true });
      if (await realpath(root) !== root) throw new Error('Invalid workspace');
      const directory = resolve(root, 'local-inputs'); await mkdir(directory, { recursive: true });
      if (await realpath(directory) !== directory) throw new Error('Invalid import directory');
      const extension = extname(name).toLowerCase();
      if (extension && !/^\.[a-z0-9]{1,12}$/.test(extension)) throw new Error('Invalid extension');
      const bytes = Buffer.from(data, 'base64'); if (bytes.length > 20 * 1024 * 1024) throw new Error('File too large');
      const target = resolve(directory, randomUUID() + extension);
      await writeFile(target, bytes, { flag: 'wx' });
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ localPath: target, originalName: name, note: '這是唯讀來源的沙盒副本；修改原檔必須使用 local_files propose 並由使用者確認套用。' })); return;
    }
    if (body.method === 'runner/generatedImages' || body.method === 'runner/generatedImage') {
      const { threadId, imageId } = body.params ?? {};
      if (typeof threadId !== 'string' || !/^[0-9a-f-]{36}$/.test(threadId)) throw new Error('Invalid thread');
      if (body.method === 'runner/generatedImage' && (typeof imageId !== 'string' || !/^exec-[0-9a-f-]{36}\.png$/.test(imageId))) throw new Error('Invalid image');
      const root = resolve(home, 'generated_images');
      const directory = resolve(root, threadId);
      let actual: string;
      try { actual = await realpath(directory); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && body.method === 'runner/generatedImages') { response.setHeader('Content-Type', 'application/json'); response.end('[]'); return; }
        throw error;
      }
      if (actual !== directory || await realpath(root) !== root) throw new Error('Invalid image directory');
      response.setHeader('Content-Type', 'application/json');
      if (body.method === 'runner/generatedImages') {
        const entries = await readdir(directory, { withFileTypes: true });
        const images = await Promise.all(entries.filter(entry => entry.isFile() && /^exec-[0-9a-f-]{36}\.png$/.test(entry.name)).map(async entry => {
          const file = await open(resolve(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
          try { const info = await file.stat(); return { id: entry.name, createdAt: info.birthtime.toISOString() }; } finally { await file.close(); }
        }));
        response.end(JSON.stringify(images)); return;
      }
      const file = await open(resolve(directory, imageId), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 15 * 1024 * 1024) throw new Error('Invalid image size');
        const image = await file.readFile();
        if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Invalid image format');
        response.end(JSON.stringify({ image: image.toString('base64') })); return;
      } finally { await file.close(); }
    }
    if (body.method === 'runner/preview') {
      const { id, extension } = body.params ?? {};
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || !['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension)) throw new Error('Invalid attachment');
      const directory = await mkdtemp(resolve(tmpdir(), 'preview-'));
      try {
        const source = resolve(process.env.UPLOAD_DIR ?? '/uploads', id + extension);
        await promisify(execFile)('libreoffice', ['-env:UserInstallation=file://' + directory + '/profile', '--headless', '--convert-to', 'pdf', '--outdir', directory, source], { timeout: 45000, maxBuffer: 1024 * 1024 });
        const pdf = await readFile(resolve(directory, id + '.pdf'));
        if (pdf.length > 30 * 1024 * 1024) throw new Error('預覽檔案過大');
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ pdf: pdf.toString('base64') })); return;
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
    await start();
    if (body.method === 'runner/toolResponse') {
      toolRequests.delete(body.params.id);
      child?.stdin.write(JSON.stringify({ id: body.params.id, result: body.params.result }) + '\n');
      response.setHeader('Content-Type', 'application/json');
      response.end('{}'); return;
    }
    if (!methods.has(body.method)) throw new Error('Method not allowed');
    if (body.params?.cwd) {
      /** 即使控制 API 參數出錯，也不可設定沙盒外的工作目錄。 */
      const path = resolve(body.params.cwd);
      if (!path.startsWith(workspace + '/')) throw new Error('Invalid workspace');
      await mkdir(path, { recursive: true });
    }
    if (body.method === 'thread/start' || body.method === 'thread/resume') {
      body.params.sandbox = 'workspace-write';
      body.params.approvalPolicy = 'never';
    }
    if (body.method === 'account/login/start' && body.params?.type !== 'chatgptDeviceCode') throw new Error('Only managed device login is allowed');
    /** 回應不包含任何 app-server 登入快取檔案。 */
    const result = await call(body);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Runner request failed' }));
  }
});
server.listen(Number(process.env.RUNNER_PORT ?? 3041), process.env.RUNNER_HOST ?? '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { child?.kill('SIGTERM'); server.close(); process.exit(0); });
