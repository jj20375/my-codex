/** @file 從本機設定產生隔離的測試環境，不複製任何真實 Codex 登入狀態。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
/** 測試檔一律位於被忽略的 .runtime。 */
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.runtime'), { recursive: true, mode: 0o700 });
/** 沿用專用應用帳號，測試 DB 另外授權。 */
let environment = await readFile(resolve(root, '.env'), 'utf8');
/** 覆寫所有測試資料與程序路徑，不使用正式 Codex binary。 */
const overrides = { DB_NAME: 'codex_workspace_test', API_PORT: '3301', RUNNER_URL: 'http://127.0.0.1:3341', WORKSPACE_DIR: resolve(root, '.runtime/integration/workspaces'), UPLOAD_DIR: resolve(root, '.runtime/integration/uploads'), DATA_DIR: resolve(root, '.runtime/integration/api'), CODEX_STATE_DIR: resolve(root, '.runtime/integration/codex'), CODEX_BIN: resolve(root, 'tests/fake-codex.mjs') };
for (const [key, value] of Object.entries(overrides)) environment = environment.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
environment += '\nRUNNER_PORT=3341\n';
/** 憑證只寫入本機忽略檔，權限為擁有者可讀寫。 */
const file = resolve(root, '.runtime/integration.env');
await writeFile(file, environment, { mode: 0o600 });
/** 有指定容器時，一併建立測試資料庫。 */
if (process.argv[2]) {
  const child = spawn(process.execPath, [resolve(root, 'scripts/bootstrap-existing-db.mjs'), process.argv[2]], { cwd: root, env: { ...process.env, BOOTSTRAP_ENV_FILE: file }, stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else console.log('已建立測試環境，請另行建立 codex_workspace_test 資料庫並授權應用帳號。');
