/** @file 驗證伺服器環境變數；路徑、憑證與部署參數不進入前端 bundle。 */
import { resolve } from 'node:path';
import { z } from 'zod';
/** 啟動時即拒絕缺少金鑰與無效連線設定。 */
const environment = z.object({
  DB_HOST: z.string().default('127.0.0.1'), DB_PORT: z.coerce.number().int().positive().default(9529),
  DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/).default('codex_workspace'), DB_USER: z.string().default('codex_workspace'), DB_PASSWORD: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(12), SESSION_SECRET: z.string().min(32), RUNNER_SECRET: z.string().min(32),
  RUNNER_URL: z.url().default('http://127.0.0.1:3041'), WEB_ORIGIN: z.url().default('http://localhost:4327'),
  LOCAL_FILES_URL: z.url().default('http://127.0.0.1:3042'), LOCAL_FILES_SECRET: z.string().default(''),
  API_HOST: z.string().default('127.0.0.1'), API_PORT: z.coerce.number().int().default(3001),
  DATA_DIR: z.string().default('../../.runtime/api'), WORKSPACE_DIR: z.string().default('../../.runtime/workspaces'),
  UPLOAD_DIR: z.string().default('../../.runtime/uploads'), COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
}).parse(process.env);
export const config = { ...environment, DATA_DIR: resolve(environment.DATA_DIR), WORKSPACE_DIR: resolve(environment.WORKSPACE_DIR), UPLOAD_DIR: resolve(environment.UPLOAD_DIR) };
