FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-fund --no-audit

FROM dependencies AS build
COPY apps apps
COPY scripts/generate-csp.mjs scripts/generate-csp.mjs
COPY nginx.conf nginx.conf
RUN mkdir -p .runtime && npm run build && node scripts/generate-csp.mjs

FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1 NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
RUN mkdir -p /data/api /uploads /workspace && chown -R node:node /data /uploads /workspace
USER node
CMD ["sh", "-c", "node apps/api/dist/migrate.js && node apps/api/dist/main.js"]

FROM node:24-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep curl python3 python3-venv libreoffice-calc libreoffice-impress libreoffice-writer fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/documents && /opt/documents/bin/pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/apps/runner ./apps/runner
ENV NODE_ENV=production RUNNER_HOST=0.0.0.0 RUNNER_PORT=3041 CODEX_BIN=/app/node_modules/.bin/codex PATH=/opt/documents/bin:/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
RUN mkdir -p /data/codex /workspace /uploads && chown -R node:node /data /workspace /uploads
USER node
CMD ["node", "apps/runner/dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY --from=build /app/.runtime/nginx.generated.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
