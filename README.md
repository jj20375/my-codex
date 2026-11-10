# Codex Workspace

個人本機的 Codex 網頁工作空間。使用自己的 ChatGPT / Codex 訂閱登入，以官方 `codex app-server` 管理對話；前端採 Astro、React、Tailwind 與 SWR，後端採 NestJS、Sequelize 與 MariaDB。

這個版本是本機 Docker 應用，瀏覽器開啟操作介面，尚未包裝為原生 `.exe` 或 `.AppImage`。每台安裝由一位擁有者使用，不提供共用訂閱的多使用者服務。

## 已實作

- Codex 風格聊天、任務列表、官方模型與推理強度選單、Markdown 回覆與即時串流。
- 裝置碼登入自己的 Codex 帳戶；前端不讀取或保存 access token。
- 可新增、編輯功能 prompt，送出時保存指示快照。
- 每次最多 10 個附件，每檔 20 MiB：PDF、XLS/XLSX、CSV（UTF-8）、DOC/DOCX、PPT/PPTX、JPG、PNG。支援選擇檔案、拖放至輸入框與直接貼上剪貼簿圖片；上傳後可點擊附件預覽，Office 檔案由 runner 轉為 PDF。後端驗證數量、大小、副檔名與檔案標頭。內容透過工作容器內工具讀取，損壞、加密或掃描文件可能需要額外處理。
- 每個 session 獨立工作目錄、產出檔案列表與下載。
- 每個 session 的官方累積 token 用量，包含輸入、快取輸入、輸出、推理輸出；快取與推理是子集合，不能再加進總數。
- 官方訂閱額度百分比與恢復時刻；未知資料顯示未知。訂閱額度與 token 總數分開。
- 聊天呼叫 `propose_schedule` 建立排程提案，擁有者確認後才啟用。支援單次或至少五分鐘的固定週期；預設排程語意為 Asia/Taipei。介面日期依瀏覽器本機時區顯示。
- MariaDB 持久佇列、限額等待、到期重試、原 thread 接續、取消、重新啟動對帳。
- Windows PowerShell 與 Linux / macOS Bash 的 Docker 安裝腳本。

## 現有這台電腦

已沿用 `mariadb-phpmyadmin-docker_mariadb-1`，主機 port `9529`，新增 `codex_workspace` 資料庫與專用帳號。既有 root 密碼不寫入專案；應用使用限制在專用資料庫內的帳號。

```bash
docker compose up -d --build --wait
```

開啟 <http://localhost:4327>，登入密碼為本機 `.env` 的 `ADMIN_PASSWORD`。首次登入後進入「帳戶與設定」，按「登入 Codex 訂閱帳戶」，開啟官方驗證頁輸入一次性碼。若未啟用裝置碼登入，請先在 ChatGPT 安全設定啟用。

phpMyAdmin 沿用 <http://localhost:9101>，可查看 `codex_workspace`，`codex_workspace_test` 為隔離的整合測試資料庫。

若 macOS 的 shell 找不到 `docker-credential-osxkeychain`，先將 `/Applications/Docker.app/Contents/Resources/bin` 加入該 shell 的 PATH。

## 新電腦快速安裝

先安裝並啟動 Docker Desktop（Windows 請使用 Linux containers）或 Docker Engine + Compose v2。需能下載 Docker、npm 與 Python 套件；建議至少 4 GB 可用記憶體及數 GB 可用磁碟。安裝腳本不會自動安裝作業系統層的 Docker。

Linux / macOS：

```bash
bash scripts/install.sh
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

預設會一併建立獨立 MariaDB，資料保存於 named volume。腳本只在 `.env` 不存在時產生隨機秘密，既有設定不覆寫。工作空間密碼保存在 `.env` 的 `ADMIN_PASSWORD`。

若使用現有資料庫，先產生並填妥 `.env`，建立專用 DB 與帳號，再使用 `--existing-db`：

```bash
node scripts/configure.mjs
node scripts/bootstrap-existing-db.mjs YOUR_MARIADB_CONTAINER
bash scripts/install.sh --existing-db
```

`bootstrap-existing-db.mjs` 透過容器內的 `MARIADB_ROOT_PASSWORD` 或 `MYSQL_ROOT_PASSWORD` 使用管理員，不會輸出或複製 root 憑證。這個輔助步驟需要 Node 24.15+；只有 Docker 的環境可依安裝腳本的掛載方式執行設定腳本，再由資料庫管理員建立 DB / 帳號。

現有資料庫 Docker 連線使用 `.env` 的 `DOCKER_DB_HOST` 和 `DB_PORT`；預設為 `host.docker.internal:9529`，Linux 由 Compose 的 `host-gateway` 對應。主機的 DB 必須允許此連線。

Windows 使用 `--existing-db`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 --existing-db
```

## 持久任務如何續跑

1. 送出前，同一 transaction 保存使用者訊息、原始 prompt、功能 prompt 與附件 ID。
2. 官方 thread ID 在第一次 turn 前落盤。每次派送都有 job ID 與 attempt 標記。
3. `usageLimitExceeded` / `rateLimitExceeded` 使任務進入 `waiting_quota`。優先採官方的相關額度恢復時刻；未知時每五分鐘重新確認，不假設一定五小時。
4. 額度可用時 `thread/resume` 原 thread，再發起新的 turn，要求先讀取歷史與 `PROGRESS.md` 接續。這不是恢復同一條已斷線的推論串流。
5. API 或 runner 重啟後，透過原 turn ID 與派送標記對帳；已完成 turn 不重播。明確中斷的 turn 自動接續，使用者取消則保持取消。
6. 如果送出結果無法確認，標記 `needs_review`，避免盲目重做有副作用的操作。可以檢查原聊天及進度檔後在同一聊天要求繼續。

主機休眠、Docker 關閉或斷網期間不會執行。排程錯過多次週期時，合併補跑一次，避免大量堆積。單一安裝一次執行一個 job；目前 API 必須維持一個副本。

任務中心以聊天 session 合併多次執行；狀態顯示進行中或最近一次執行。Dashboard 的各期任務數以該期有執行的不同 session 計算，同一 session 在不同日期有活動時會在各日期各計一次；排程執行次數另行顯示。任務的「已完成」指官方 turn 回報完成，沒有額外的獨立驗收 agent；仍應檢查實際交付成果。`PROGRESS.md` 是給模型的持久指示，不能保證所有模型回覆都會產出完整進度檔。

## 容器與資料

```text
Browser → Nginx / Astro + React → NestJS API → MariaDB
                                  ↓
                              Codex runner → 官方 app-server
                                  ↓
                         持久工作區 / 附件 / Codex 狀態
```

- 只在主機 `127.0.0.1:4327` 開放介面；API 與 runner 不公開 port。
- runner 不掛載主機家目錄或 Docker socket，不持有資料庫憑證。非 root 執行、root filesystem 唯讀，有程序及記憶體上限。
- Codex 採 `workspace-write` 與 `approvalPolicy: never`，不允許提升到沙盒外操作；允許容器內工作工具連外下載依賴。這是個人可信任任務的環境，不是可接受任意陌生人程式的多租戶隔離平台。
- `codex_state` volume 包含登入快取及官方 rollout，必須與 DB、`uploads`、`workspaces` 一起保存及備份，不要上傳或分享憑證。
- Cookie 為 HttpOnly / SameSite=Strict，寫入驗證來源及自訂 header，登入有限速，下載做 realpath 邊界檢查，前端 CSP 於建置時計算 Astro bootstrap hash。

保留資料停止服務：

```bash
docker compose stop
# 新機含資料庫的安裝則使用：
docker compose -f compose.yaml -f compose.standalone.yaml stop
```

請保留相同 Compose 專案名稱與 volumes。`down -v` 會移除持久資料，不應當作一般重新啟動方式。不要在變更 DB 密碼後直接刪除 `.env` 重新產生，既有 MariaDB volume 的使用者密碼不會跟著變更。

## 套件與開發

需要 Node 24.15+、MariaDB。`npm ci` 使用專案 `.npmrc` 的 peer 相容設定，正式 Docker 版本由 lockfile 固定。

```bash
npm ci
npm run db:migrate
npm run dev:runner
# 另一個終端
npm run dev:api
# 另一個終端
npm run dev:web
```

開發腳本會從專案根目錄 `.env` 載入設定；預設資料保存在 `.runtime/`。Docker 與本機開發的 Codex 狀態是分開的，不會自動複製你主機現有 Codex 登入。

前端開發伺服器使用 `.env` 的 `WEB_PORT`，例如 `4325` 對應 `http://localhost:4325`；`WEB_ORIGIN` 必須填相同的網址，修改後重新啟動前端與 API。連接埠已被使用時，前端會提示錯誤，請釋放該埠或更換設定。

runner 已附 Python、pypdf、openpyxl、python-pptx、python-docx、Pillow、pandas、xlrd、LibreOffice、CJK 字型、git、ripgrep。新增系統套件請修改 Dockerfile，新增常駐 Python 套件請修改 `requirements.txt` 再重建 runner；任務也可在自己的工作區建立 `.venv` 或 `node_modules`。不提供網頁版任意 root 套件安裝器。

正式映像採 Astro 7，適用相同的 Astro / React island 邊界規則；只有單一 React app island，沒有巢狀 hydration。

## 驗證

```bash
npm run check
npm run build
npm test
```

在 macOS / Linux 的開發環境可準備並執行整合測試：

```bash
npm run test:prepare -- YOUR_MARIADB_CONTAINER
npm run test:integration
```

`tests/integration.mjs` 使用 `.runtime/integration.env`、`_test` 專用資料庫與 `tests/fake-codex.mjs`。測試會留下可檢查的 mock 紀錄，不會呼叫真實模型。

本次自動驗證涵蓋：認證、HttpOnly cookie、寫入來源、官方目錄模型驗證、附件簽章與十檔上限、限額等待、API + runner 同時重啟後同 thread 接續、重送用量事件去重、確認排程後才執行、下載和路徑／symlink 邊界。

真實帳戶仍須人工登入。真實推論、各格式文件的模型讀取品質與真實五小時額度恢復，不能用 mock 測試宣稱已通過。Windows 安裝腳本仍需在 Windows 主機實測。

## 官方依據

- [Codex app-server：thread、turn、模型、用量、帳戶及動態工具](https://learn.chatgpt.com/docs/app-server)
- [Codex Authentication：裝置碼登入與容器憑證保存](https://learn.chatgpt.com/docs/auth)
- [Sign in with ChatGPT 的本機開源／個人使用範圍](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

本機個人使用是此版本的範圍；若將來做成收費或遠端代管產品，應重新確認當時官方開放範圍與授權方式。

## 頁面路由

- `/login`：工作空間登入。登入後會返回原本的頁面。
- `/`：新聊天；`/sessions/:sessionId`：已保存的聊天。
- `/jobs`、`/schedules`、`/features`：任務、排程及功能管理。
- `/usage`、`/settings`：用量 dashboard 與帳戶設定。

可以重新整理、複製網址，以及使用瀏覽器的上一頁／下一頁。登入仍受工作空間 cookie 保護。

## 連接本機原始資料夾

此功能需要主機執行 Node.js 24；Docker 本身不能替瀏覽器取得任意主機路徑。安裝腳本在主機已有 Node 時會啟動檔案服務。既有安裝請先執行：

```bash
node scripts/configure.mjs
node scripts/start-local-files.mjs
docker compose up -d --build
```

聊天上方會常駐顯示目前 session 的參考資料夾名稱、實際路徑與權限，並提供移除參考與管理入口。切換聊天會切換對應清單。同一聊天以實際路徑／資料夾識別去重，不因尾斜線、別名或不同權限重複加入；同一資料夾可供不同聊天各自參考。既有重複連接啟動時合併，保留清單歷史，權限衝突採唯讀，需更改權限時請先中斷後重連。

新增聊天，按右上角「連接資料夾」，選擇唯讀或允許修改，再透過主機選取視窗或絕對路徑連接。拖入資料夾會開啟連接流程；瀏覽器不會自行把拖入的資料夾變成 Docker 掛載。既有官方 thread 沒有新工具，請在新增聊天使用。

- 可閱讀一般檔案的沙盒副本，再由 AI 提出分類、重新命名、建立資料夾或修改 UTF-8 文字的清單。
- 原檔變更只在按下「確認並套用」後執行；可略過清單。讀取與檔案變更單檔上限 20 MB，文字寫入上限 1 MB；一次清單最多 100 項，單層目錄最多列出 500 個非隱藏項目。PDF／Office 等副本由 runner 現有文件工具解析，損壞或加密檔案仍可能無法閱讀。
- 連接與清單保存在 `.runtime/local-files/state.json`；文字覆寫的原始內容保存在 `.runtime/local-files/backups/<清單ID>/<操作序號>`。部分失敗不會自動重試，介面列出已完成數量與錯誤；服務在套用途中停止時須人工檢查，不保證整批原子回滾。
- 不跟隨符號連結，不覆寫分類或改名的目的檔；檔案內容與提案時不同就停止。變更不支援硬連結檔案，移動需位於同一檔案系統。中斷連接後，已讀入沙盒的副本仍會保留。
- macOS 選取視窗使用 osascript，Windows 使用 PowerShell FolderBrowserDialog，Linux 使用 zenity；未安裝 zenity 時可在介面輸入主機絕對路徑。Windows 與 Linux 原生選取視窗尚未在本機驗證。
- 關閉網頁不會停止服務；主機重開後請再次執行 `node scripts/start-local-files.mjs`，此版尚未建立開機自動啟動。啟動 PID 與服務 log 位於 `.runtime/local-files/`。
- 主機服務金鑰 `LOCAL_FILES_SECRET` 僅由 API 使用，不會傳給瀏覽器或 Codex。macOS／Windows 預設綁定 127.0.0.1，Linux 預設綁定 0.0.0.0 以供 Docker host-gateway 存取，可在 `.env` 設定 `LOCAL_FILES_HOST` 與 `LOCAL_FILES_PORT`。變更 port 時也須同步修改 Compose 的 `LOCAL_FILES_URL`。

## 電商營運工作台

`/commerce` 為營運總覽，`/commerce/products` 管理商品與客群，`/commerce/campaigns` 管理活動、上線檢核及 AI 工作包，`/commerce/orders` 登錄訂單及付款／全額退款狀態。每頁都有獨立路由。

商品事實與優惠會存入活動 AI 工作的 prompt 快照，產出客群與購買阻力、優惠／毛利試算、文案、銷售頁、售後回購流程及追蹤實驗計畫。重複點擊同活動會返回既有工作聊天；建立新活動可產出另一份工作包。此功能沿用持久任務、額度等待及工作區檔案預覽。

訂單也可透過 CSV 批次匯入，每次最多 500 筆、1 MB。欄位依序為 `number,product,campaign,quantity,total,status,date`，商品與活動以系統中唯一名稱對應，活動可留白；金額使用 NT$、日期使用 YYYY-MM-DD（台北時間），狀態填 pending／paid／refunded／cancelled。任一筆格式、對應或單號錯誤會整批回滾。

目前營運數據為人工登錄，累積統計、統一新台幣、金額以整數分儲存。已付款淨額排除待付款、取消及全額退款；僅支援整筆退款。活動成交率只用已歸因訂單／已登錄訪問；ROAS 使用已歸因付款額／實際花費，並非利潤。無分母不顯示比率，未填成本不捏造毛利。訂單單號唯一且下單總額不受後續商品改價影響。

本版未串接商店、金流、廣告、Email 或 LINE，不自動發布或發送訊息；活動狀態與檢核為人工營運紀錄，並非外部平台已上線的證明。清空初始資料，未植入示範營收或顧客。

### 商品內容工作台（第一階段）

從「電商營運台 → 商品與賣點」建立商品事實，點選「開啟內容工作台」。每個商品有獨立路由 `/commerce/products/:productId/content`，草稿保存在 MariaDB 的 `commerce_content_drafts`（migration `006_content_drafts`）。

選商品類型、用途與最多十個附件，選擇模型／強度後按「保存並交給 AI 製作」。生成使用現有持久任務、額度等待及續跑；可開啟專用聊天繼續要求修改。工作完成後回工作台按「載入已完成的 AI 結果」，逐欄編輯商品、SEO、FB／IG／Threads／LINE 文案、候選標籤與待確認事項，再保存或匯出 JSON。結果格式不符、結果檔未更新、任務未完成、正式商品來源已改動或草稿版本衝突，都會阻止載入／覆寫。

第一階段只保存內容草稿，尚未串接 coBuy 正式上架、社群發布、舊網址自動匯入與節慶資料服務。模型提出的規格、標籤與活動內容仍需檢查；不將生成次數當作成交成效。整合測試使用 `_test` 資料庫與模擬 Codex，不能當作真實訂閱額度耗盡的證明。

### coBuy 工作包與社群草稿

已支援 coBuy 商品工作包匯入、來源去重及回寫包匯出；coBuy 可預覽差異並逐欄套用，socai 可匯入平台文案並先保存草稿。完整操作、來源版本規則、測試與部署邊界見 [整合實作說明](docs/content-exchange-implementation.md)。這階段採明確的 JSON 工作包交換；媒體跨系統搬移與自動任務同步尚未接通。
