# 本機工作台直接串接 coBuy 與 SocAI

更新日期：2026-11-04。

## 操作流程

1. 在「帳戶與設定 → 系統連線」或 `/commerce/connections`，設定 coBuy API、媒體服務與店家 ID，以及 SocAI API 與工作區 ID。兩邊各使用該系統目前已登入的 JWT；不輸入 OpenAI／Gemini API key，也不轉送 Codex 的 auth.json。
2. 「商品與賣點」直接從 coBuy 搜尋、翻頁並選商品，可連同已核定圖集讀入。更新既有來源需明確勾選，草稿保留。
3. 在商品內容工作台選模型與強度，生成或對話修改內容，載入並保存草稿。勾選要回傳的商品圖片。
4. 「送到商城與社群 → 預覽 coBuy 更新差異」檢查原值／建議值及目標店家與商品，勾選欄位後套用。圖片選項會取代商品圖集，第一張作為主圖。
5. 在同一頁選 Facebook／Instagram／Threads 文案，核對內容與帳號，建立 SocAI 草稿；圖片自動匯入目標工作區。相同版本／目標／選圖重送會返回原草稿。
6. 正式發布或排程仍在 SocAI 草稿審核流程操作。本輪沒有提供本機立即發布或自動排程入口。

## 部署與登入

三個服務仍各自執行，本機工作台負責透過 API 統一日常操作，不需要下載和搬運 JSON。coBuy／SocAI 不需要為此輪更新新增端點；沿用前階段已完成的內容、媒體與貼文 API。

Docker 內連主機服務時，API 位址例如 `http://host.docker.internal:實際連接埠/api`，coBuy 媒體另填 `http://host.docker.internal:實際媒體連接埠`。若服務只綁在主機 loopback 而無法從容器連入，需依現有部署調整可達位址。正式遠端服務使用 HTTPS。

JWT 目前由使用者首次填入；到期或遠端撤銷後需重新登入該系統並更新連線。尚未實作跨系統 SSO、OAuth 授權碼或長效服務帳號，不宣稱永久免登入。狀態「已設定」表示曾驗證保存；實際操作會再次通過遠端 JWT 與店別／工作區權限。

coBuy 服務回傳 localhost 的媒體網址時，只在設定 host.docker.internal 且協定、連接埠相同時替換為 Docker 主機別名。其他媒體來源一律拒絕。

## 邊界與持久化

- 端點全受本機 OwnerGuard 與同來源寫入檢查保護；沒有通用 URL 代理或模型可任意執行的外部請求工具。
- JWT 以 SESSION_SECRET 派生專用金鑰，AES-256-GCM 加密並以 provider 作 AAD；0600 檔案位於 DATA_DIR/commerce-connections。摘要 API 不回傳 JWT、密文或社群平台 token。
- SESSION_SECRET 輪替後需重新連線。密文、來源綁定及傳送記錄位於 API 持久 volume，容器更新後保留。
- baseUrl 由擁有者明確設定，只允許本機 HTTP 或 HTTPS，拒絕 URL 帳密、query、fragment 及已知 metadata 位址。請求路徑由程式固定；Authorization 請求不追蹤重新導向。回應有大小和時間上限。
- 商品以來源連線身分、店家、原商品 ID 與版本指紋共同確認；切換服務不能沿用舊來源。遠端商品更新仍經 coBuy 原有 transaction、選欄白名單與來源衝突檢查。
- 草稿必須保存且版本符合；只能轉送此草稿明確勾選的 JPG／PNG，最多10張、每張5 MiB，不自動傳送其他參考檔。圖片採各系統本地 ID 與 SHA 重用。
- 社群只送目前工作區、目前連線身分且平台相符的已綁定帳號。POST posts 不攜帶 scheduledAt，也不呼叫 publish。
- 貼文建立前以 wx 寫入持久唯一標記；並行及重送不會再建立相同草稿。逾時或回應不明改為 needs_review，需先到 SocAI 核對，不會盲目重送。若確認未建立，可保存新的草稿版本再操作；本輪沒有自動對帳或人工解除標記介面。
- 圖片上傳與正式套用是跨服務操作，失敗時已上傳圖片可能保留媒體庫；重試使用 SHA 查找。沒有跨系統分散式交易。

## 本機 API

前綴 `/api/commerce/connected`，均需本機登入：

| 方法與路徑 | 用途 |
| --- | --- |
| GET /connections | 不含秘密的連線摘要 |
| PUT /connections/:provider | 驗證並加密保存固定連線，provider=cobuy/socai |
| DELETE /connections/:provider | 解除連線 |
| GET /cobuy/products?keyword=&page=1 | 管理商品摘要列表及連線身分 |
| POST /cobuy/import | 指定 connectionId、commodityId、refresh、includeImages 讀入商品 |
| POST /products/:id/preview | revision、images 形成保存快照，讀取 coBuy 差異 |
| POST /products/:id/apply | revision、images、fields，明確選欄套用 |
| GET /socai/accounts | 帳號 ID、名稱、平台及連線身分，排除平台秘密 |
| POST /products/:id/social-draft | revision、images、platform、accountIds、connectionId；僅建立草稿 |

## 驗收

- 本機型別檢查、建置及35項測試通過，包含加密完整性、不同 provider 不能解密、URL／媒體來源限制、FormData、無導向、持久並行送出標記與深層路由。
- 隔離 coBuy／SocAI 資料庫的實際 JWT／ORM／媒體服務驗證通過：搜尋商品→讀取核定圖集→保存草稿→差異預覽→選欄套用→本機來源版本同步→社群素材與草稿。
- 新合成 PNG 另驗證真正分段上傳、合併回呼及 ready，與 SocAI FormData 上傳；沒有只驗證既有圖片重用。
- 驗證舊草稿版本、非本草稿附件、未登入請求拒絕；商品售價保持原值；連線及帳號回應不含 token；同一社群草稿重送返回原ID。
- 真實帳戶連線、完整瀏覽器操作與正式平台發布／排程未執行。需要使用者在連線頁設定實際服務授權。

部署完成：本機 api／web Docker 已更新，api／runner 健康；`/commerce/connections` 回傳200，未登入存取連線摘要 API 為401。隔離測試服務已停止，沒有為使用者自動填入正式帳戶憑證。
