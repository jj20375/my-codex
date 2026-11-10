/** @file 統一處理本機 API、HttpOnly cookie 與錯誤訊息；前端不接觸 Codex 或資料庫憑證。 */
export interface Usage {
  /** 官方總 token。 */ totalTokens: number;
  /** 輸入 token，包含快取輸入。 */ inputTokens: number;
  /** 輸出 token，包含推理輸出。 */ outputTokens: number;
  /** 已快取輸入 token。 */ cachedInputTokens: number;
  /** 推理輸出 token，為輸出子集合。 */ reasoningOutputTokens: number;
}
export interface Session {
  /** 聊天識別碼。 */ id: string;
  /** 顯示標題。 */ title: string;
  /** 模型代碼。 */ model: string;
  /** 推理強度。 */ effort: string;
  /** 官方累積用量；未回傳時為未知。 */ usage: Usage | null;
  /** 最近更新時間。 */ updatedAt: string;
}
export interface Message {
  /** 訊息建立時間，用於排列產生的圖片。 */ createdAt: string;
  /** 訊息識別碼。 */ id: string;
  /** user 或 assistant。 */ role: string;
  /** 安全以 Markdown 呈現的文字。 */ text: string;
  /** 附件識別碼。 */ attachments: string[];
}
export interface Job {
  /** 工作識別碼。 */ id: string;
  /** 所屬聊天。 */ sessionId: string;
  /** 原始請求。 */ prompt: string;
  /** 任務狀態。 */ state: string;
  /** 下次執行或額度查詢時間。 */ runAt: string;
  /** 人類可讀進度。 */ detail: string;
  /** 已送出 turn 次數。 */ attempts: number;
}
export interface Execution {
  /** 執行識別碼。 */ id: string;
  /** 原始工作。 */ jobId: string;
  /** 所屬聊天。 */ sessionId: string;
  /** 額度續跑的嘗試序號。 */ attempt: number;
  /** 實際送出時的模型。 */ model: string;
  /** 實際送出時的強度。 */ effort: string;
  /** 官方快照的已記錄增量。 */ usage: Usage | null;
  /** 執行建立時間。 */ createdAt: string;
}
export interface Feature {
  /** 功能識別碼。 */ id: string;
  /** 功能名稱。 */ name: string;
  /** 功能指示。 */ prompt: string;
}
export interface Schedule {
  /** 排程識別碼。 */ id: string;
  /** 聊天識別碼。 */ sessionId: string;
  /** 排程標題。 */ title: string;
  /** 執行內容。 */ prompt: string;
  /** 下次執行時間。 */ nextRunAt: string;
  /** null 為單次，否則週期分鐘。 */ intervalMinutes: number | null;
  /** proposed、active、paused、completed。 */ state: string;
}
export interface ModelOption {
  /** 官方模型代碼。 */ model: string;
  /** 官方顯示名稱。 */ displayName: string;
  /** 預設選項。 */ isDefault: boolean;
  /** 預設推理強度。 */ defaultReasoningEffort: string;
  /** 支援強度。 */ supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
}
export interface Attachment {
  /** 已上傳的附件識別碼。 */ id: string;
  /** 檔案名稱。 */ name: string;
  /** 位元組數。 */ size: number;
}
export interface LimitWindow {
  /** 官方已使用百分比。 */ usedPercent: number;
  /** 視窗分鐘數。 */ windowDurationMins: number;
  /** 恢復 Unix 秒。 */ resetsAt: number | null;
}
export interface LimitBucket {
  /** 額度桶顯示名稱。 */ limitName?: string | null;
  /** 主要額度。 */ primary: LimitWindow | null;
  /** 次要額度。 */ secondary: LimitWindow | null;
}
export interface Account {
  /** runner 是否可連線。 */ connected: boolean;
  /** 官方帳戶資訊，未登入為 null。 */ account: { type: string; email?: string; planType?: string } | null;
  /** 官方額度，無法讀取為 null。 */ limits: { rateLimits?: LimitBucket; rateLimitsByLimitId?: Record<string, LimitBucket> } | null;
}
export interface Detail {
  /** 聊天設定。 */ session: Session;
  /** 持久訊息。 */ messages: Message[];
  /** 此聊天持久任務。 */ jobs: Job[];
}
/** 以相同來源呼叫 JSON 或 multipart API，並將錯誤交給 UI。 @param path API 路徑。 @param options 請求設定。 @returns 解析結果。 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  /** multipart boundary 必須由瀏覽器產生，不能手動指定 Content-Type。 */
  const headers = new Headers(options.headers);
  headers.set('x-workspace-client', 'web');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  /** 所有認證只使用 HttpOnly cookie。 */
  const response = await fetch('/api' + path, { ...options, credentials: 'same-origin', headers });
  /** 預期錯誤採 JSON，代理服務失敗亦提供可讀訊息。 */
  const data = await response.json().catch(() => ({ message: '伺服器暫時沒有回應' }));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join('；') : data.message ?? `請求失敗 (${response.status})`);
  return data as T;
}
/** 格式化 token 顯示，未知不顯示成零。 @param value token 計數。 @returns 可讀字串。 */
export function tokens(value: number | undefined): string { return value === undefined ? '—' : new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
/** 將 ISO 日期轉為本機時區顯示。 @param value 時間。 @returns 可讀時間。 */
export function date(value: string): string { return new Date(value).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
/** 任務狀態提供一致的中文顯示。 */
export const stateNames: Record<string, string> = { queued: '等待執行', dispatching: '準備中', running: '執行中', waiting_quota: '等待額度', completed: '已完成', failed: '執行失敗', cancelled: '已取消', needs_review: '待檢查', proposed: '待確認', active: '已啟用', paused: '已暫停' };
