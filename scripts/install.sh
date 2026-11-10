#!/usr/bin/env bash
# 本機 Docker 安裝器；不修改既有資料庫或下載後直接執行遠端腳本。
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo '請先安裝並啟動 Docker Engine 或 Docker Desktop。'; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup node:24-bookworm-slim node scripts/configure.mjs
compose_files=(-f compose.yaml -f compose.standalone.yaml)
if [[ "${1:-}" == '--existing-db' ]]; then
  compose_files=(-f compose.yaml)
  echo '使用既有 MariaDB；請先依 README 建立專用資料庫並填妥 .env。'
fi
docker compose "${compose_files[@]}" up -d --build --wait --wait-timeout 240
if command -v node >/dev/null; then
  node scripts/start-local-files.mjs
else
  echo '連接本機資料夾功能需在主機安裝 Node.js 24，再執行 node scripts/start-local-files.mjs。'
fi
web_port=$(sed -n 's/^WEB_PORT=//p' .env | head -1)
echo "安裝完成：http://localhost:${web_port:-4327}"
echo '登入密碼：.env 的 ADMIN_PASSWORD。停止服務請使用相同 compose 檔案執行 stop；保留 volumes 才能續跑。'
