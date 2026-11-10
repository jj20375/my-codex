/** @file 純函式處理官方額度視窗與錯誤分類，供持久佇列和限額驗證共用。 */
export interface LimitWindow {
  /** 官方已使用百分比。 */ usedPercent: number;
  /** 視窗長度，分鐘。 */ windowDurationMins?: number;
  /** 官方恢復時間，Unix 秒。 */ resetsAt?: number | null;
}
export interface LimitBucket {
  /** 官方計量識別碼。 */ limitId?: string | null;
  /** 此額度對應的一般模型。 */ normalModelSlug?: string | null;
  /** 主要限制視窗。 */ primary?: LimitWindow | null;
  /** 次要限制視窗。 */ secondary?: LimitWindow | null;
}
export interface Limits {
  /** 舊版單一額度桶。 */ rateLimits?: LimitBucket | null;
  /** 多額度桶，以 limit id 索引。 */ rateLimitsByLimitId?: Record<string, LimitBucket> | null;
}
/** 選擇與模型相關的額度桶，未知時保留單一桶相容資訊。 @param input 官方限制及選取模型。 @returns 對應額度桶。 */
export function bucketFor({ limits, model }: { limits: Limits; model: string }): LimitBucket | null {
  return Object.values(limits.rateLimitsByLimitId ?? {}).find(bucket => bucket.normalModelSlug === model || bucket.limitId === model)
    ?? limits.rateLimitsByLimitId?.codex ?? limits.rateLimits ?? null;
}
/** 僅對已耗盡且尚未到恢復時刻的視窗等待；未知恢復時間改為五分鐘查詢。 @param input 官方額度與目前時間。 @returns 下次可查詢時間或 null。 */
export function quotaRetryAt({ limits, model, now = Date.now() }: { limits: Limits; model: string; now?: number }): Date | null {
  /** 百分比與恢復時間均由伺服器提供，不能從 token 數推算。 */
  const bucket = bucketFor({ limits, model });
  /** 忽略已過期視窗，讓下一次真實請求確認是否恢復。 */
  const exhausted = [bucket?.primary, bucket?.secondary].filter(window => window && window.usedPercent >= 100 && (!window.resetsAt || window.resetsAt * 1000 > now));
  if (!exhausted.length) return null;
  return new Date(Math.max(...exhausted.map(window => window?.resetsAt ? window.resetsAt * 1000 + 5000 : now + 300_000)));
}
/** 僅明確的官方限額錯誤允許自動延後，不將授權或付款問題當成可恢復限額。 @param info 官方錯誤碼。 @returns 是否可以等待恢復。 */
export function isQuotaError(info: unknown): boolean {
  return info === 'usageLimitExceeded' || info === 'rateLimitExceeded';
}
