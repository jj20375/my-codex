/** @file 工作空間管理畫面：任務、排程、功能與官方帳戶；由擁有者登入後呼叫同來源 API。 */
import { useState } from 'react';
import {Link} from 'react-router-dom';
import useSWR from 'swr';
import { Activity, ArrowUpRight, Check, ChevronRight, Clock3, Code2, LogOut, Plus, Save, ShieldCheck, X } from 'lucide-react';
import UsageDashboard from './UsageDashboard';
import ExecutionDetails from './ExecutionDetails';
import { groupTasks } from './taskGroups';
import { api, date, stateNames, tokens, type Execution, type Account, type Feature, type Job, type Schedule, type Session } from './api';

interface PanelProps {
  /** 選中的管理頁面。 */ view: string;
  /** 操作後刷新工作空間。 */ refresh: () => void;
  /** 把任務切回對應聊天。 */ openSession: (id: string) => void;
  /** 顯示 API 錯誤。 */ report: (message: string) => void;
  /** 回到聊天。 */ close: () => void;
}
export default function Panels({ view, refresh, openSession, report, close }: PanelProps) {
  /** 正在編輯的功能資料，切換功能時更新。 */
  const [editing, setEditing] = useState<Feature | null>(null);
  /** 表單名稱，只有送出後才寫入資料庫。 */
  const [name, setName] = useState('');
  /** 功能 prompt 的本機草稿。 */
  const [prompt, setPrompt] = useState('');
  /** 防止多次提交相同設定。 */
  const [saving, setSaving] = useState(false);
  /** 裝置登入的公開 URL 與一次性碼；不含 access token。 */
  const [login, setLogin] = useState<{ verificationUrl: string; userCode: string } | null>(null);
  const { data: jobs } = useSWR<Job[]>(view === 'jobs' ? '/jobs' : null, api, { refreshInterval: 3000 });
  const { data: taskSessions } = useSWR<Session[]>(view === 'jobs' ? '/sessions' : null, api, { refreshInterval: 3000 });
  /** 執行快照保持獨立，避免變更聊天模型後覆蓋歷史。 */
  const { data: executions = [], error: executionError } = useSWR<Execution[]>(view === 'jobs' ? '/executions' : null, api, { refreshInterval: 3000 });
  const groupedJobs = groupTasks(jobs ?? []);
  const { data: schedules } = useSWR<Schedule[]>(view === 'schedules' ? '/schedules' : null, api, { refreshInterval: 3000 });
  const { data: features } = useSWR<Feature[]>(view === 'features' ? '/features' : null, api);
  const { data: account } = useSWR<Account>(view === 'settings' ? '/account' : null, api, { refreshInterval: 10_000 });
  const titles: Record<string, string> = { jobs: '任務中心', schedules: '排程任務', features: '自訂功能', settings: '帳戶與設定', usage: 'Token 用量' };

  /** 所有管理操作共用錯誤回報與刷新流程。 */
  async function action({ path, body, method = 'POST' }: { path: string; body?: unknown; method?: string }) {
    setSaving(true);
    try { await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); refresh(); }
    catch (error) { report(error instanceof Error ? error.message : '操作失敗'); }
    finally { setSaving(false); }
  }
  /** 切換功能時同步表單，空白功能表示新增。 */
  function edit(feature: Feature | null) { setEditing(feature); setName(feature?.name ?? ''); setPrompt(feature?.prompt ?? ''); }
  /** 官方裝置碼登入可在 Docker 與跨平台環境使用。 */
  async function signIn() {
    setSaving(true);
    try { setLogin(await api('/account/login', { method: 'POST' })); refresh(); }
    catch (error) { report(error instanceof Error ? error.message : '登入失敗'); }
    finally { setSaving(false); }
  }
  return <section className="management flex-1 overflow-y-auto">
    <header className="panel-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>{titles[view]}</h1></div><button className="icon-button" onClick={close} aria-label="返回聊天"><X size={19} /></button></header>
    {view === 'jobs' && <>
      <p className="intro">每個聊天顯示為一個任務，狀態以進行中或最近一次執行為準。額度恢復後會接續執行。</p>
      <div className="stat-grid"><Stat label="進行中" value={String(groupedJobs.filter(job => ['running', 'dispatching', 'queued'].includes(job.state)).length ?? 0)} /><Stat label="等待額度" value={String(groupedJobs.filter(job => job.state === 'waiting_quota').length ?? 0)} /><Stat label="已完成" value={String(groupedJobs.filter(job => job.state === 'completed').length ?? 0)} /></div>
      <div role="alert">{executionError && `無法載入執行用量：${executionError.message}`}</div><div className="record-list">{groupedJobs.length ? groupedJobs.map(job => <article className="record" key={job.sessionId}><div className={'record-icon ' + job.state}><Activity size={19} /></div><div className="record-body"><button className="record-title" onClick={() => openSession(job.sessionId)}>{taskSessions?.find(session => session.id === job.sessionId)?.title ?? job.prompt.slice(0, 100)}<ChevronRight size={15} /></button><p>{job.detail}</p><small>{stateNames[job.state]} · 最近一次執行嘗試 {job.attempts} 次{job.state === 'waiting_quota' && ` · 下次確認 ${date(job.runAt)}`}</small><p>聊天累積 Token：{tokens(taskSessions?.find(session => session.id === job.sessionId)?.usage?.totalTokens)}</p><ExecutionDetails executions={executions.filter(execution => execution.sessionId === job.sessionId)} /></div>{['queued', 'dispatching', 'running', 'waiting_quota'].includes(job.state) && <button className="text-button" disabled={saving} onClick={() => void action({ path: `/jobs/${job.id}/cancel` })}>取消</button>}</article>) : <Empty title="還沒有任務" text="在聊天裡送出一個需求，就會建立可以追蹤的持久任務。" />}</div>
    </>}
    {view === 'schedules' && <>
      <p className="intro">在聊天裡描述時間與工作，確認提案後就能自動執行。</p>
      <div className="callout"><Clock3 size={21} /><div><strong>試試：「明天早上 9 點，幫我整理這個專案的待辦」</strong><p>排程使用台北時區。電腦與 Docker 必須保持運作；離線錯過的週期會合併補跑一次。</p></div></div>
      <div className="record-list">{schedules?.length ? schedules.map(schedule => <article className="record" key={schedule.id}><div className="record-icon"><Clock3 size={20} /></div><div className="record-body"><button className="record-title" onClick={() => openSession(schedule.sessionId)}>{schedule.title}<ChevronRight size={15} /></button><p>{schedule.prompt}</p><small>{stateNames[schedule.state]} · {date(schedule.nextRunAt)} · {schedule.intervalMinutes ? `每 ${schedule.intervalMinutes} 分鐘` : '單次執行'}</small></div><button disabled={saving || schedule.state === 'completed'} className={schedule.state === 'active' ? 'text-button' : 'primary-button'} onClick={() => void action({ path: `/schedules/${schedule.id}`, method: 'PATCH', body: { state: schedule.state === 'active' ? 'paused' : 'active' } })}>{schedule.state === 'active' ? '暫停' : schedule.state === 'completed' ? '已執行' : <><Check size={15} />確認啟用</>}</button></article>) : <Empty title="把重複的工作，交給排程" text="回到聊天，告訴 Codex 要做什麼、何時開始，以及是否重複。" />}</div>
    </>}
    {view === 'features' && <>
      <p className="intro">將常用指示存成一個功能。選取功能、輸入需求，就能用自己的方式工作。</p>
      <div className="feature-layout"><div className="feature-list"><button className="new-feature" onClick={() => edit(null)}><Plus size={17} />新增功能</button>{features?.map(feature => <button key={feature.id} className={editing?.id === feature.id ? 'selected' : ''} onClick={() => edit(feature)}><Code2 size={17} /><span>{feature.name}</span><ChevronRight size={15} /></button>)}</div>
        <form className="feature-form" onSubmit={async event => { event.preventDefault(); await action({ path: editing ? `/features/${editing.id}` : '/features', method: editing ? 'PATCH' : 'POST', body: { name, prompt } }); }}>
          <div className="section-label">{editing ? '編輯功能' : '新增功能'}</div><label>功能名稱<input required maxLength={100} placeholder="例如：每週報告助手" value={name} onChange={event => setName(event.target.value)} /></label><label>功能指示<textarea required maxLength={30000} rows={12} placeholder="描述這個功能的工作方式、回應格式與完成條件…" value={prompt} onChange={event => setPrompt(event.target.value)} /></label><p className="form-hint">功能指示會套用到新送出的任務。排隊中的工作會保留送出時的版本。</p><button disabled={saving} className="primary-button"><Save size={16} />{saving ? '儲存中…' : '儲存功能'}</button>
        </form></div>
    </>}
    {view === 'settings' && <>
      <p className="intro">每個安裝環境使用自己的帳戶與本機資料。</p><Link className="primary-button" to="/commerce/connections">設定 coBuy／SocAI 系統連線 →</Link>
      <div className="settings-card"><div className="settings-card-heading"><div className="account-symbol"><Code2 size={25} /></div><div><h2>Codex 帳戶</h2><p>{account?.account?.email ?? '連接你的 ChatGPT 訂閱，開始工作'}</p></div><span className={'pill ' + (account?.account ? 'success' : '')}>{account?.account?.planType ?? (account?.connected ? '尚未登入' : '執行器離線')}</span></div>
        {account?.account ? <div className="settings-actions"><span className="muted">Using ChatGPT plan</span><button className="text-button" disabled={saving} onClick={() => void action({ path: '/account/logout' })}><LogOut size={15} />登出 Codex</button></div> : <><button className="primary-button" disabled={saving} onClick={() => void signIn()}>{saving ? '取得驗證碼…' : '登入 Codex 訂閱帳戶'}<ArrowUpRight size={16} /></button>{login && <div className="device-login"><p>開啟官方驗證頁，輸入一次性代碼：</p><strong>{login.userCode}</strong><a className="text-button" href={login.verificationUrl} target="_blank" rel="noreferrer">開啟 OpenAI 登入頁<ArrowUpRight size={15} /></a><small>完成後此頁會自動更新。若裝置碼登入未啟用，請先在 ChatGPT 安全設定開啟。</small></div>}</>}
      </div>
      <div className="settings-card"><h2>訂閱額度</h2><p className="form-hint">額度為帳戶共用，包含其他 Codex 工具的使用；無法換算為固定剩餘 token。</p>{account?.limits ? Object.entries(account.limits.rateLimitsByLimitId ?? { codex: account.limits.rateLimits }).map(([key, bucket]) => bucket && <div key={key} className="quota-group"><div className="section-label">{bucket.limitName ?? key}</div>{[bucket.primary, bucket.secondary].filter(window => window !== null && window !== undefined).map((window, index) => window && <div className="quota-window" key={index}><div><span>{window.windowDurationMins >= 60 ? `${window.windowDurationMins / 60} 小時` : `${window.windowDurationMins} 分鐘`}視窗</span><strong>{Math.max(0, 100 - window.usedPercent).toFixed(0)}% 剩餘</strong></div><progress max={100} value={Math.max(0, 100 - window.usedPercent)} /><small>{window.resetsAt ? `${date(new Date(window.resetsAt * 1000).toISOString())} 恢復` : '官方尚未提供恢復時間'}</small></div>)}</div>) : <p className="muted">尚未取得官方額度資料</p>}<a className="text-button" href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noreferrer">Manage usage<ArrowUpRight size={15} /></a></div>
      <div className="callout"><ShieldCheck size={22} /><div><strong>個人本機・持久保存</strong><p>登入憑證由官方 Codex 保管。聊天、附件與任務保存在你的 Docker volumes，agent 只在工作容器內執行。</p></div></div>
    </>}
    {view === 'usage' && <UsageDashboard openSession={openSession} />}
  </section>;
}
/** 顯示平行統計。 */
function Stat({ label, value }: { /** 統計名稱。 */ label: string; /** 格式化後數值。 */ value: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
/** 所有管理頁共用空狀態。 */
function Empty({ title, text }: { /** 標題。 */ title: string; /** 說明。 */ text: string }) { return <div className="empty-state"><div className="empty-symbol"><Activity size={24} /></div><h2>{title}</h2><p>{text}</p></div>; }
