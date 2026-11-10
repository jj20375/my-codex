# 商品工作包與社群草稿整合

更新日期：2026-11-03。

## 已完成的操作流程

1. coBuy CMS「商品管理 → AI 內容」：下載指定商品工作包。
2. 本機 Codex「商品與賣點」：選取 coBuy 工作包。來源以 system、tenantId、commodityId 去重；預設重開既有商品，勾選更新來源才覆寫本機保存的售價與事實，草稿保留。
3. 本機內容工作台選模型與強度、加入參考檔案、生成與修訂，完成後匯出 JSON。工作包帶回 coBuy 來源指紋；本機 UUID 不當作 Commodity ID。
4. coBuy 原商品的 AI 內容頁：上傳完成內容包，預覽每欄原值與建議值、待確認事項，勾選名稱／簡介／詳情／SEO 欄位後套用。
5. socai「貼文管理」：匯入同一份完成內容包，預覽平台文案與圖片後採用。圖片匯入目前工作區媒體庫，重新選擇發文帳號，預設保存草稿；仍可沿用原有立即／排程發布。

## 圖片與商品頁 SEO

- coBuy 商品內容頁可選媒體庫圖片、上傳新圖、調整順序與替代文字，第一張作為主圖。保存圖集使用相同的來源版本檢查與交易，不改售價、庫存及上架狀態。
- 圖片工作包最多10張 JPG／PNG，每張5 MiB、合計50 MiB；JSON 檔案上限72 MiB。交換實際圖片位元組、MIME、SHA-256 與替代文字，不交換其他系統的媒體 UUID、儲存路徑或短效網址。
- 本機需明確勾選草稿附件中的商品圖才能匯出；私人參考文件不會自動包含。匯入檢查簽章、大小、雜湊與重複圖片。
- coBuy 沿用既有分段上傳、合併回呼與 ready 狀態；只接受商品擁有店別的圖片。socai 使用目前工作區的媒體權限與上傳端點。兩端依 SHA 重用素材。
- 公開商品圖片依商品、店別與圖集索引取得，再導向短效圖片網址；未綁定的私人媒體不會因此公開。
- 商城商品頁以路由 loader 輸出初始 HTML，包括商品內容、title、description、canonical、Open Graph 與 Product／Offer JSON-LD。價格取自公開商品資料；未知庫存不捏造有貨。404 保留 HTTP 狀態並輸出 noindex。
- 公開站部署請配置 VITE_SITE_PUBLIC_ORIGIN、VITE_PUBLIC_BASE_PATH 與 VITE_SITE_TENANT_ID；canonical 移除追蹤參數，租戶與 API 不能由網址 query 改寫。JSON-LD 特殊字元已跳脫。

coBuy 路由為 `/cms/co-buy/app/modules/product-management/commodities/:commodityId/content`。本機路由為 `/commerce/products/:productId/content`。socai 入口為既有 `/app/posts`，沒有另建僅替換 component 的假頁面。

## 權限與版本

- 共用的是經檢查的工作包，不交換 JWT、Codex 登入或資料庫憑證。
- coBuy 每次讀取、預覽與套用都驗證 JWT 管理者、商品原始店別；共享販售不代表可修改。
- 來源指紋涵蓋正式商品更新與內容版本。來源商品、店別或版本不符拒絕套用。
- 套用使用 transaction 與商品列鎖，寫入不可變歷史；只採勾選欄位，不更動價格、狀態、庫存或配方。
- 公開 DTO 只包含已套用的商品文字、SEO 與圖集索引／替代文字；不輸出媒體 UUID、社群文案、待確認事項、私人參考資料。
- 社群採用時清空原商品、模板與帳號，將明確選取的圖片轉成目前工作區素材，並切換為草稿；外部附件 UUID 不能當成本地媒體 ID。

## 資料庫與部署

- 本機 migration `007_product_sources`：新增 `commerce_product_sources`，隨 Docker API 啟動執行。
- coBuy migration `20261103010000-commodity-content-revisions.js`：新增 `commodity_content_revisions`，已只對本機 `cobuy` 套用此新增表；未執行其他待辦 migration，未更改既有商品、訂單或庫存。
- socai 沿用既有草稿與排程資料表，沒有 schema 異動。
- 圖集保存在既有 commodity_content_revisions.content.images JSON，本輪沒有新增 migration。
- 本機 Docker 已更新；coBuy／socai 程式需由各自既有啟動方式載入新版本，未重啟使用者的其他應用或操作外部平台。

## 驗證結果

- 本機：型別、建置、30項測試及 MariaDB／模擬 Codex 整合測試通過；新增圖片工作包格式、去重、草稿附件隔離與匯出案例。
- coBuy：前後端型別檢查、CMS／商城與後端建置、18項商品／圖片測試及3項 SEO 契約測試通過。隔離 MariaDB 驗證並行套用、交易還原、跨店拒絕、圖片分段上傳與公開內容白名單。
- socai：前端型別檢查與建置通過，3項內容包／草稿發布分流測試通過。
- 隔離資料的完整 API 往返通過：coBuy 圖片上傳 → 本機保存與選圖匯出 → 回填同商品 → socai 素材與草稿保存。SHA 一致、售價不變、圖片不洩漏其他租戶的資產識別。
- 瀏覽器已確認本機附件／選圖入口、coBuy 圖集預覽並實際保存替代文字、socai 含圖片與 hashtag 的草稿列表。驗證畫面保存於 .runtime/media-seo/gallery-verified.png 與 social-draft-verified.png。
- 原始 HTTP 驗證商品內容、metadata、JSON-LD、可信店別及 404/noindex 通過。修正購物車初始化擋住商品 SSR，以及錯誤頁冒泡遺失 noindex。
- 限制：擴充套件未開啟本機檔案存取，瀏覽器選檔與自動下載未完整驗證；相同匯入／匯出 API 已通過。真實 Codex 額度耗盡、外部平台發布與排程到期未執行。所有新驗收使用假商品與假社群帳號，未修改正式商品或對外發文。

## 後續仍需完成

自動任務同步、文章／節慶資料服務、來源點擊到訂單的追蹤與正式平台發布驗收。現階段以使用者明確選取的工作包交換資料，沒有自動上架或自動選擇發布時間。

## 統一工作台 API 操作（2026-11-04）

已新增 `/commerce/connections` 連線設定、商品列表直接從 coBuy 選取，以及內容頁的差異預覽／選欄回填／SocAI 草稿建立。日常操作可直接使用 API，原有 JSON 工作包仍可使用。首次需設定各系統目前登入 JWT，憑證只以密文保存在本機後端；不是共用 Codex 登入或新增付費 AI API key。正式發布與排程仍經 SocAI 審核流程。詳細授權、部署、錯誤恢復與驗收見 [connected-commerce.md](connected-commerce.md)。
