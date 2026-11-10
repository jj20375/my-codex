/** @file 透過既有 MariaDB 容器的管理環境建立專用 DB 與使用者；管理憑證不寫入新專案。 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
/** 只使用安全白名單的名稱與自動產生的密碼，避免 SQL 引號注入。 */
const environment = Object.fromEntries((await readFile(process.env.BOOTSTRAP_ENV_FILE ?? new URL('../.env', import.meta.url), 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const separator = line.indexOf('='); return [line.slice(0, separator), line.slice(separator + 1)]; }));
for (const key of ['DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!/^[a-zA-Z0-9_-]+$/.test(environment[key] ?? '')) throw new Error(`不安全的 ${key}，請使用自動產生設定`);
/** 容器名稱為 CLI 參數，並非 shell 插值。 */
const container = process.argv[2];
if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('請指定既有 MariaDB 容器名稱');
/** 只在容器內取管理密碼，不以 docker inspect 或日誌輸出。 */
const child = spawn('docker', ['exec', '-i', container, 'sh', '-c', 'export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-$MYSQL_ROOT_PASSWORD}"; exec mariadb -u root'], { stdio: ['pipe', 'pipe', 'pipe'] });
/** 僅在 bootstrap 階段需要 DDL；應用業務查詢全部使用 Sequelize。 */
const sql = `CREATE DATABASE IF NOT EXISTS \`${environment.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER IF NOT EXISTS '${environment.DB_USER}'@'%' IDENTIFIED BY '${environment.DB_PASSWORD}';\nGRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON \`${environment.DB_NAME}\`.* TO '${environment.DB_USER}'@'%';\n`;
child.stdin.end(sql);
child.stdout.resume();
child.stderr.resume();
child.on('exit', code => { if (code !== 0) { console.error('建立專用資料庫失敗，請確認容器名稱及其管理員環境設定。'); process.exitCode = 1; } else console.log('專用資料庫與應用使用者已建立；既有 root 憑證未變更。'); });
