import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** 開發與預覽讀取專案根目錄的埠設定，環境變數優先於 .env。 */
const envFile = new URL('../../.env', import.meta.url);
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const webPort = Number(process.env.WEB_PORT ?? fileEnv.WEB_PORT ?? 4327);
if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
  throw new Error('WEB_PORT 必須是 1 到 65535 之間的整數');
}

export default defineConfig({
  integrations: [react()],
  server: { host: 'localhost', port: webPort },
  vite: { plugins: [tailwindcss(), {
    name: 'workspace-routes',
    configureServer(server) {
      /** 開發伺服器的深層網址也載入 React Router 入口。 */
      server.middlewares.use((request, _response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        if (request.method === 'GET' && request.headers.accept?.includes('text/html') && (/^\/(login|jobs|schedules|features|usage|settings)\/?$/.test(path) || /^\/sessions\/[^/]+\/?$/.test(path) || /^\/commerce(?:\/[^?#]*)?$/.test(path))) request.url = '/';
        next();
      });
    },
  }], server: { strictPort: true, proxy: { '/api': process.env.WORKSPACE_API_URL ?? 'http://127.0.0.1:3001' } }, preview: { strictPort: true } },
  devToolbar: { enabled: false },
});
