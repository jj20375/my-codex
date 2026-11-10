/** @file Astro 的 hydration bootstrap 含 inline script，建置後計算確切雜湊以維持嚴格 CSP。 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
/** 此靜態應用只有一個頁面，新增頁面時應收集所有頁面的 script hash。 */
const html = await readFile(new URL('../apps/web/dist/index.html', import.meta.url), 'utf8');
/** 只雜湊 inline 腳本內容；外部 bundle 由 self 規則允許。 */
const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(match => match[1]).map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
/** 不引入 unsafe-inline 或 unsafe-eval。 */
const template = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8');
await writeFile(new URL('../.runtime/nginx.generated.conf', import.meta.url), template.replace("script-src 'self'", `script-src 'self' ${[...new Set(hashes)].join(' ')}`));
console.log(`CSP 已產生 ${new Set(hashes).size} 個 inline script 雜湊`);
