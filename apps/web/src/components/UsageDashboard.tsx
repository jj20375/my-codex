/** @file 顯示 session 用量增量、任務建立數與排程清單，資料來自本機資料庫。 */
import { useState } from 'react';
import useSWR from 'swr';
import ExecutionDetails from './ExecutionDetails';
import { countTasks } from './taskGroups';
import { api, date, stateNames, tokens, type Session, type Schedule, type Usage, type Execution } from './api';

type Period = 'day' | 'week' | 'month' | 'year';
interface UsageRow { /** 對應 session。 */ sessionId: string; /** 到達時間。 */ createdAt: string; /** 快照增量。 */ usage: Usage }
interface JobRow { /** 任務識別碼。 */ id: string; /** 來源聊天。 */ sessionId: string; /** 排程來源。 */ scheduleId: string | null; /** 建立時間。 */ createdAt: string }
interface Dashboard { /** 歷次模型及用量快照。 */ executions: Execution[]; /** 從啟用統計後記錄的增量。 */ events: UsageRow[]; /** 所有已建立工作。 */ jobs: JobRow[]; /** session 的官方累積值。 */ sessions: Session[]; /** 排程設定。 */ schedules: Schedule[] }
/** 台北時間固定 UTC+8，週一開始一週。 */
function startPeriod({ value, period }: { value: Date; period: Period }): Date {
  const local = new Date(value.getTime() + 8 * 3600_000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth(), day = local.getUTCDate();
  if (period === 'year') return new Date(Date.UTC(year, 0, 1) - 8 * 3600_000);
  if (period === 'month') return new Date(Date.UTC(year, month, 1) - 8 * 3600_000);
  const start = Date.UTC(year, month, day) - 8 * 3600_000;
  return new Date(start - (period === 'week' ? (local.getUTCDay() + 6) % 7 * 86400_000 : 0));
}
/** 依時間尺度往前推移，使用台北日曆月與年。 */
function shift({ start, period, count }: { start: Date; period: Period; count: number }): Date {
  const local = new Date(start.getTime() + 8 * 3600_000);
  if (period === 'month') local.setUTCMonth(local.getUTCMonth() + count);
  else if (period === 'year') local.setUTCFullYear(local.getUTCFullYear() + count);
  else local.setUTCDate(local.getUTCDate() + count * (period === 'week' ? 7 : 1));
  return new Date(local.getTime() - 8 * 3600_000);
}
/** 在既有工作空間呈現互動式時間統計與排程。 */
export default function UsageDashboard({ openSession }: { /** 點選後回到原聊天。 */ openSession: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>('day');
  const { data, error } = useSWR<Dashboard>('/usage/dashboard', api, { refreshInterval: 5000 });
  const current = startPeriod({ value: new Date(), period });
  const end = shift({ start: current, period, count: 1 });
  const inCurrent = (value: string) => { const time = new Date(value).getTime(); return time >= current.getTime() && time < end.getTime(); };
  const events = data?.events.filter(event => inCurrent(event.createdAt)) ?? [];
  const jobs = data?.jobs.filter(job => inCurrent(job.createdAt)) ?? [];
  const total = events.reduce((sum, event) => sum + event.usage.totalTokens, 0);
  const input = events.reduce((sum, event) => sum + event.usage.inputTokens, 0);
  const output = events.reduce((sum, event) => sum + event.usage.outputTokens, 0);
  const periods = Array.from({ length: 12 }, (_, i) => {
    const begin = shift({ start: current, period, count: i - 11 });
    const until = shift({ start: begin, period, count: 1 });
    const rows = (data?.events ?? []).filter(row => new Date(row.createdAt) >= begin && new Date(row.createdAt) < until);
    const count = countTasks((data?.jobs ?? []).filter(row => new Date(row.createdAt) >= begin && new Date(row.createdAt) < until));
    return { begin, total: rows.reduce((sum, row) => sum + row.usage.totalTokens, 0), count };
  });
  const max = Math.max(1, ...periods.map(item => item.total));
  const labels: Record<Period, string> = { day: '每日', week: '每週', month: '每月', year: '每年' };
  function label(value: Date) { return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', ...(period === 'year' ? { year: 'numeric' } : period === 'month' ? { year: '2-digit', month: 'numeric' } : { month: 'numeric', day: 'numeric' }) }).format(value); }
  if (error) return <p role="alert">無法載入用量：{error.message}</p>;
  if (!data) return <p className="intro">正在載入統計…</p>;
  return <>
    <p className="intro">台北時間；週一至週日為一週。用量按系統收到 Codex 累積快照的時間記錄，啟用統計以前的歷史無法按日期還原。任務按本期有執行的不同聊天數統計，同一聊天計一次。</p>
    <div className="period-controls" role="group" aria-label="統計週期">{(Object.keys(labels) as Period[]).map(key => <button key={key} className={period === key ? 'active' : ''} aria-pressed={period === key} onClick={() => setPeriod(key)}>{labels[key]}</button>)}</div>
    <div className="stat-grid dashboard-stats"><div className="stat"><span>本{labels[period].slice(1)} Token</span><strong>{tokens(total)}</strong></div><div className="stat"><span>輸入 / 輸出</span><strong>{tokens(input)} / {tokens(output)}</strong></div><div className="stat"><span>本期活躍任務</span><strong>{countTasks(jobs)}</strong><small>其中 {jobs.filter(job => job.scheduleId).length} 次為排程執行</small></div></div>
    <h2 className="dashboard-heading">最近 12 個{labels[period].slice(1)}期</h2><div className="dashboard-chart" role="img" aria-label="各期 Token 用量及任務數"><div className="chart-columns">{periods.map(row => <div className="chart-column" key={row.begin.toISOString()} title={`${label(row.begin)}：${row.total.toLocaleString()} tokens，${row.count} 個任務`}><span>{row.total ? tokens(row.total) : '—'}</span><div className="chart-bar-track"><div className="chart-bar" style={{ height: `${row.total ? Math.max(3, row.total / max * 100) : 0}%` }} /></div><small>{label(row.begin)}</small><small>{row.count} 任務</small></div>)}</div></div>
    <h2 className="dashboard-heading">各 Session 用量</h2><p className="form-hint">本期用量是開始記錄後的增量；累積用量為 Codex 提供的 session 總量。— 代表尚未取得。</p>
    <div className="usage-table"><div className="usage-row table-head"><span>聊天 / Session</span><span>本期</span><span>任務</span><span>累積</span></div>{data.sessions.map(session => <div key={session.id}><button className="usage-row" onClick={() => openSession(session.id)}><span><span>{session.title}<small>目前設定：{session.model} · {session.effort}</small></span></span><span>{tokens(events.filter(row => row.sessionId === session.id).reduce((sum, row) => sum + row.usage.totalTokens, 0))}</span><span>{jobs.some(job => job.sessionId === session.id) ? 1 : 0}</span><strong>{tokens(session.usage?.totalTokens)}</strong></button><ExecutionDetails executions={data.executions.filter(execution => execution.sessionId === session.id)} /></div>)}</div>
    <h2 className="dashboard-heading">排程任務清單</h2><p className="form-hint">同一聊天的排程執行合併為一個任務，排程執行次數另行統計。</p>{data.schedules.length ? data.schedules.map(schedule => <div className="record" key={schedule.id}><div className="record-body"><button className="record-title" onClick={() => openSession(schedule.sessionId)}>{schedule.title}</button><p>{schedule.prompt}</p><small>{stateNames[schedule.state]} · {schedule.state === 'active' ? `下次 ${date(schedule.nextRunAt)}` : `排定 ${date(schedule.nextRunAt)}`} · {schedule.intervalMinutes ? `每 ${schedule.intervalMinutes} 分鐘` : '單次'}</small></div></div>) : <p className="form-hint">尚無排程任務。</p>}
  </>;
}
