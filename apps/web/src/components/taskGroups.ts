/** @file 以 session 合併執行紀錄，保留實際可取消的進行中執行。 */
export interface TaskExecution {
  /** 所屬 session。 */ sessionId: string;
  /** 執行狀態。 */ state: string;
}
/** 各 session 優先顯示尚未結束的執行，否則顯示由新到舊排序的第一筆。 */
export function groupTasks<T extends TaskExecution>(jobs: T[]): T[] {
  const active = new Set(['queued', 'dispatching', 'running', 'waiting_quota']);
  const grouped = new Map<string, T>();
  for (const job of jobs) {
    const current = grouped.get(job.sessionId);
    if (!current || !active.has(current.state) && active.has(job.state)) grouped.set(job.sessionId, job);
  }
  return [...grouped.values()];
}
/** 統計期間有執行紀錄的不同 session 數量。 */
export function countTasks(jobs: Pick<TaskExecution, 'sessionId'>[]): number {
  return new Set(jobs.map(job => job.sessionId)).size;
}
