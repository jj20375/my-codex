# Windows PowerShell 5.1+，需要已啟動且採 Linux containers 的 Docker Desktop。
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '請先安裝並啟動 Docker Desktop（Linux containers）。' }
docker compose version
if ($LASTEXITCODE -ne 0) { throw '找不到 Docker Compose v2。' }
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker 尚未啟動。' }
docker run --rm -v "${PWD}:/setup" -w /setup node:24-bookworm-slim node scripts/configure.mjs
if ($LASTEXITCODE -ne 0) { throw '環境設定產生失敗。' }
$composeFiles = @('-f', 'compose.yaml', '-f', 'compose.standalone.yaml')
if ($args -contains '--existing-db') { $composeFiles = @('-f', 'compose.yaml'); Write-Host '使用既有 MariaDB，請先填妥 .env 並建立專用資料庫。' }
docker compose @composeFiles up -d --build --wait --wait-timeout 240
if ($LASTEXITCODE -ne 0) { throw '容器啟動失敗，請查看 docker compose logs。' }
if (Get-Command node -ErrorAction SilentlyContinue) { node scripts/start-local-files.mjs } else { Write-Host '連接本機資料夾功能需在主機安裝 Node.js 24，再執行 node scripts/start-local-files.mjs。' }
$webPort = ((Get-Content .env | Where-Object { $_ -match '^WEB_PORT=' }) -replace '^WEB_PORT=', '')
Write-Host "安裝完成：http://localhost:$webPort"
Write-Host '登入密碼保存在 .env 的 ADMIN_PASSWORD。請保留 Docker volumes 以維持任務與登入狀態。'
