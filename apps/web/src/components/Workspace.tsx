/** @file Astro 的單一 React island，提供 Codex 風格聊天、附件與管理導覽；登入前不載入私人工作資料。 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react';
import ContentWorkbench from './ContentWorkbench';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { routes, managementViews, sessionPath, type ManagementView } from './routes';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Activity, ArrowUp, ArrowUpRight, BarChart3, ChevronDown, Clock3, Code2, File, FileText, FolderOpen, Loader2, LogOut, Menu, MessageSquare, MoreHorizontal, PanelLeftClose, Paperclip, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Terminal, X, Zap } from 'lucide-react';
import Panels from './Panels';
import Commerce from './Commerce';
import ConnectionSettings from './ConnectedCommerce';
import ArtifactPanel from './ArtifactPanel';
import LocalFolders from './LocalFolders';
import ReferenceFolders from './ReferenceFolders';
import { api, date, stateNames, tokens, type Account, type Attachment, type Detail, type Feature, type ModelOption, type Session } from './api';

export default function Workspace() {
  return <BrowserRouter><AuthBoundary /></BrowserRouter>;
}
/** 將未登入的深層網址導向登入頁，登入後回到原頁。 */
function AuthBoundary() {
  const location = useLocation();
  const { data: auth, error, mutate } = useSWR<{ authenticated: boolean }>('/auth/status', api);
  /** 只有擁有者登入表單持有密碼草稿，不寫入 localStorage。 */
  const [password, setPassword] = useState('');
  /** 登入錯誤會顯示於表單下方。 */
  const [loginError, setLoginError] = useState('');
  /** 登入提交期間禁止重複請求。 */
  const [submitting, setSubmitting] = useState(false);
  async function login(event: { preventDefault(): void }) {
    event.preventDefault(); setSubmitting(true); setLoginError('');
    try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); await mutate(); }
    catch (error) { setLoginError(error instanceof Error ? error.message : '登入失敗'); }
    finally { setSubmitting(false); }
  }
  if (auth?.authenticated) {
    if (location.pathname === routes.login) {
      const requested = (location.state as { from?: string } | null)?.from;
      return <Navigate to={requested && requested.startsWith('/') && !requested.startsWith('//') && requested !== routes.login ? requested : routes.chat} replace />;
    }
    return <WorkspaceApp onLogout={() => void mutate()} />;
  }
  if (auth && location.pathname !== routes.login) return <Navigate to={routes.login} replace state={{ from: location.pathname + location.search + location.hash }} />;
  return <main className="login-page"><div className="login-glow" /><form onSubmit={login} className="login-card"><div className="logo-symbol"><Code2 size={30} /></div><div className="eyebrow">YOUR PERSONAL CODEX</div><h1>自己的工作空間。</h1><p>想法、任務與進度，在這裡接續。</p><label htmlFor="password">工作空間密碼</label><input id="password" type="password" required autoComplete="current-password" placeholder="輸入安裝時設定的密碼" value={password} onChange={event => setPassword(event.target.value)} /><button className="primary-button" disabled={submitting || !auth}>{submitting ? <Loader2 className="spin" size={17} /> : <>進入工作空間<ArrowUpRight size={17} /></>}</button>{(loginError || error) && <p className="form-error" role="alert">{loginError || '無法連線後端，請確認 Docker 服務已啟動。'}</p>}<div className="login-note"><ShieldCheck size={14} />本機運作・資料持久保存</div></form><span className="login-version">Codex Workspace / 01</span></main>;
}

interface AppProps {
  /** 擁有者登出後重新驗證外層登入。 */ onLogout: () => void;
}
function WorkspaceApp({ onLogout }: AppProps) {
  /** URL 是畫面與 session 的唯一來源，瀏覽器歷史及重新整理均會復原。 */
  const location = useLocation();
  const routeNavigate = useNavigate();
  const sessionMatch = useMatch(routes.session);
  const sessionId = sessionMatch?.params.sessionId ?? null;
  const view = sessionId || location.pathname === routes.chat ? 'chat' : managementViews.find(name => routes[name] === location.pathname) ?? (location.pathname.startsWith('/commerce') ? 'commerce' : 'notFound');
  /** 管理頁關閉時回到使用者最後開啟的聊天。 */
  const lastSession = useRef<string | null>(null);
  /** 由新聊天建立 session 時保留草稿，直到任務真正送出成功。 */
  const skipNextChatReset = useRef(false);
  const previousChat = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (view !== 'chat') return;
    if (previousChat.current !== undefined && previousChat.current !== sessionId && !skipNextChatReset.current) {
      setDraft(''); setAttachments([]); setFeatureId(''); setPreview(null); setFilesOpen(false);
    }
    skipNextChatReset.current = false;
    previousChat.current = sessionId;
    if (sessionId) lastSession.current = sessionId;
  }, [sessionId, view]);
  /** 輸入框草稿。 */
  const [draft, setDraft] = useState('');
  /** 送出時選取的功能快照來源。 */
  const [featureId, setFeatureId] = useState('');
  /** 已上傳且尚未送出的附件。 */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** 當前預覽附件與拖放狀態。 */
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 目前表單選取模型；官方目錄載入後才決定預設值。 */
  const [model, setModel] = useState('');
  /** 目前推理強度，隨模型支援選項更新。 */
  const [effort, setEffort] = useState('medium');
  /** 統一顯示前後端操作錯誤。 */
  const [error, setError] = useState('');
  /** 上傳或送出期間停用重複操作。 */
  const [busy, setBusy] = useState(false);
  /** 手機側欄顯示狀態。 */
  const [sidebar, setSidebar] = useState(false);
  /** 聊天篩選關鍵字。 */
  const [search, setSearch] = useState('');
  /** 已接收但尚未持久完成的即時文字，以官方 item ID 分組。 */
  const [live, setLive] = useState<Record<string, string>>({});
  /** agent 目前活動顯示。 */
  const [activity, setActivity] = useState('');
  /** 工作區產出面板是否展開。 */
  /** 原始本機資料夾授權與確認視窗。 */
  const [localFoldersOpen, setLocalFoldersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(new URLSearchParams(location.search).has('file'));
  useEffect(() => { if (new URLSearchParams(location.search).has('file')) setFilesOpen(true); }, [location.search]);
  const { mutate } = useSWRConfig();
  const { data: sessions = [] } = useSWR<Session[]>('/sessions', api, { refreshInterval: 5000 });
  const { data: models = [], error: modelError } = useSWR<ModelOption[]>('/models', api, { revalidateOnFocus: false });
  const { data: features = [] } = useSWR<Feature[]>('/features', api);
  const { data: account } = useSWR<Account>('/account', api, { refreshInterval: 15000 });
  const { data: detail } = useSWR<Detail>(sessionId ? `/sessions/${sessionId}` : null, api, { refreshInterval: 2500 });
  const { data: generatedImages = [] } = useSWR<Array<{ id: string; createdAt: string }>>(sessionId ? `/sessions/${sessionId}/images` : null, api, { refreshInterval: 5000 });
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 快取更新只處理登入後資料；auth/status 由外層維護。 */
  function refresh() { void mutate(key => typeof key === 'string' && key !== '/auth/status'); }
  /** 所有 API 錯誤都能在介面看到，避免無聲失敗。 */
  function report(message: string) { setError(message); }
  const selectedModel = models.find(option => option.model === model);
  const selectedFeature = features.find(feature => feature.id === featureId);
  const current = sessions.find(session => session.id === sessionId);
  /** 說明依實際功能名稱，不依資料庫回傳順序，避免卡片與功能錯置。 */
  const featureDescriptions: Record<string, string> = { '文件整理': '閱讀附件，整理重要內容', '資料分析': '檢查資料，找出關鍵資訊', '專案實作': '建立專案，追蹤執行進度' };
  const pendingJob = detail?.jobs.find(job => ['queued', 'dispatching', 'running', 'waiting_quota'].includes(job.state));
  const isWorking = !!pendingJob;
  const messageCount = detail?.messages.length ?? 0;
  const navItems = [{ id: 'jobs', label: '任務中心', icon: Activity }, { id: 'schedules', label: '排程任務', icon: Clock3 }, { id: 'features', label: '自訂功能', icon: Zap }] as const;

  useEffect(() => {
    if (!model && models.length) {
      const option = models.find(option => option.isDefault) ?? models[0];
      setModel(option.model); setEffort(option.defaultReasoningEffort);
    }
  }, [models, model]);
  useEffect(() => {
    if (detail?.session.id === sessionId) { setModel(detail.session.model); setEffort(detail.session.effort); }
  }, [detail?.session.id, sessionId]);
  useEffect(() => {
    const stream = new EventSource('/api/events');
    stream.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'delta' && data.sessionId === sessionId && typeof data.itemId === 'string' && typeof data.delta === 'string') setLive(previous => ({ ...previous, [data.itemId]: (previous[data.itemId] ?? '') + data.delta }));
        else if (data.type === 'itemDone' && data.sessionId === sessionId) setLive(previous => { const next = { ...previous }; delete next[data.itemId]; return next; });
        else if (data.type === 'activity' && data.sessionId === sessionId) setActivity(data.item === 'commandExecution' ? '正在執行工作區指令' : data.item === 'fileChange' ? '正在更新檔案' : '正在思考與處理');
        else if (data.type === 'warning') setError(data.message);
        else if (data.type !== 'heartbeat' && !refreshTimer.current) refreshTimer.current = setTimeout(() => { refreshTimer.current = null; refresh(); }, 800);
      } catch { setError('即時更新中斷，已改用定期同步。'); }
    };
    return () => { stream.close(); if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = null; };
  }, [sessionId]);
  useEffect(() => { setLive({}); setActivity(''); }, [sessionId]);
  useEffect(() => { if (!isWorking) { setLive({}); setActivity(''); } }, [isWorking]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messageCount]);

  /** 新聊天先保留在本機草稿，第一則訊息才會建立資料列。 */
  function newChat() { routeNavigate(routes.chat); setDraft(''); setAttachments([]); setFeatureId(''); setSidebar(false); setFilesOpen(false); setError(''); }
  /** 打開聊天並同步保存的模型設定。 */
  function openSession(id: string) { routeNavigate(sessionPath(id)); setDraft(''); setAttachments([]); setSidebar(false); setFilesOpen(false); setError(''); }
  /** 導覽到管理頁時收起手機側欄。 */
  function navigate(next: ManagementView) { routeNavigate(routes[next]); setSidebar(false); setError(''); }
  /** Codex 回覆的工作區檔案連結直接開啟分割預覽，避免導向不存在的網頁路由。 */
  const markdownComponents: Components = { a: ({ href, children }) => {
    const prefix = `/workspace/${sessionId}/`;
    if (sessionId && href?.startsWith(prefix)) return <button className="artifact-link" onClick={() => { const search = new URLSearchParams(location.search); search.set('file', href.slice(prefix.length)); setFilesOpen(true); routeNavigate({ pathname: location.pathname, search: search.toString() }); }}>{children}</button>;
    return <a href={href}>{children}</a>;
  } };
  /** 模型與強度同時保存，避免兩次 PATCH 產生互相覆蓋。 */
  async function selection({ nextModel, nextEffort }: { nextModel: string; nextEffort: string }) {
    setModel(nextModel); setEffort(nextEffort);
    if (current) {
      try { await api(`/sessions/${current.id}`, { method: 'PATCH', body: JSON.stringify({ title: current.title, model: nextModel, effort: nextEffort }) }); refresh(); }
      catch (error) { report(error instanceof Error ? error.message : '無法更新模型'); setModel(current.model); setEffort(current.effort); }
    }
  }
  /** 前端先檢查附件數量與大小，真正類型仍由伺服器檢查。 */
  async function uploadFiles(files: File[]) {
    if (busy) return;
    if (!files.length) return;
    if (attachments.length + files.length > 10) { report('一次最多可以附加 10 個檔案'); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024)) { report('每個檔案最多 20 MB'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData(); files.forEach(file => form.append('files', file));
      const uploaded = await api<Attachment[]>('/attachments', { method: 'POST', body: form });
      setAttachments(previous => [...previous, ...uploaded]);
    } catch (error) { report(error instanceof Error ? error.message : '上傳失敗'); }
    finally { setBusy(false); }
  }
  function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = ''; void uploadFiles(files);
  }
  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && ['image/png', 'image/jpeg'].includes(item.type)).map(item => item.getAsFile()).filter((file): file is File => file !== null);
    if (!images.length) return;
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    void uploadFiles(images.map((file, index) => new window.File([file], file.name && /\.(png|jpe?g)$/i.test(file.name) ? file.name : `貼上圖片-${Date.now()}-${index + 1}.${file.type === 'image/png' ? 'png' : 'jpg'}`, { type: file.type })));
  }
  function dropFiles(event: DragEvent<HTMLFormElement>) {
    event.preventDefault(); setDragging(false); if (busy) return; if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { void openLocalFolders(); return; } void uploadFiles(Array.from(event.dataTransfer.files));
  }
  /** 持久 job 建立成功後才清空草稿。 */
  async function send(event?: { preventDefault(): void }) {
    event?.preventDefault();
    if (!draft.trim() || busy || isWorking || !model) return;
    setBusy(true); setError('');
    try {
      let id = sessionId;
      if (!id) {
        const session = await api<Session>('/sessions', { method: 'POST', body: JSON.stringify({ title: draft.trim().slice(0, 40), model, effort }) });
        id = session.id; skipNextChatReset.current = true; routeNavigate(sessionPath(id));
      }
      await api(`/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ prompt: draft, attachments: attachments.map(file => file.id), ...(featureId ? { featureId } : {}) }) });
      setDraft(''); setAttachments([]); setLive({}); refresh();
      if (textarea.current) textarea.current.style.height = 'auto';
    } catch (error) { report(error instanceof Error ? error.message : '送出失敗'); }
    finally { setBusy(false); }
  }
  /** Enter 送出，Shift+Enter 換行；中文組字期間不提前提交。 */
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }
  /** 新聊天可先建立空 session 連接資料夾，不會送出模型請求。 */
  async function openLocalFolders() {
    try {
      if (!sessionId) {
        if (!model) throw new Error('請先連接 Codex 帳戶並選擇模型');
        const session = await api<Session>('/sessions', { method: 'POST', body: JSON.stringify({ title: '本機資料夾工作', model, effort }) });
        skipNextChatReset.current = true; routeNavigate(sessionPath(session.id)); refresh();
      }
      setLocalFoldersOpen(true);
    } catch (error) { report(error instanceof Error ? error.message : '無法建立聊天'); }
  }
  /** 取消時由後端呼叫官方 interrupt，並將取消狀態持久化。 */
  async function cancel() { if (!pendingJob) return; try { await api(`/jobs/${pendingJob.id}/cancel`, { method: 'POST' }); refresh(); } catch (error) { report(error instanceof Error ? error.message : '取消失敗'); } }
  /** 退出擁有者 cookie，不改變 runner 的 Codex 登入。 */
  async function logout() { try { await api('/auth/logout', { method: 'POST' }); await mutate(() => true, undefined, { revalidate: false }); onLogout(); } catch (error) { report(error instanceof Error ? error.message : '登出失敗'); } }

  /** 聊天路由共用同一畫面，但由 Router 分別註冊新聊天和已保存的 session。 */
  const chatPage = <div className="chat-layout"><div className="chat-column">{sessionId && <ReferenceFolders key={sessionId} sessionId={sessionId} manage={() => setLocalFoldersOpen(true)} />}
        {!sessionId ? <div className="welcome"><div className="welcome-tag"><span className="status-dot online" />一個為你打造的工作空間</div><div className="welcome-emblem"><Code2 size={38} strokeWidth={1.35} /><span className="emblem-orbit" /></div><h1>今天想完成什麼？</h1><p>從一段對話開始，讓 Codex 幫你把工作往前推進。</p><div className="quick-features">{features.slice(0, 3).map((feature, index) => <button key={feature.id} className={featureId === feature.id ? 'feature-card selected' : 'feature-card'} onClick={() => { setFeatureId(feature.id); textarea.current?.focus(); }}><span className={'feature-card-icon tone-' + index}>{feature.name === '文件整理' ? <FileText size={20} /> : feature.name === '資料分析' ? <BarChart3 size={20} /> : feature.name === '專案實作' ? <Terminal size={20} /> : <Zap size={20} />}</span><strong>{feature.name}</strong><p>{featureDescriptions[feature.name] ?? feature.prompt.slice(0, 26)}</p><ArrowUpRight className="feature-arrow" size={16} /></button>)}</div><button className="schedule-suggestion" onClick={() => { setDraft('明天早上 9 點，幫我整理這個專案目前的進度與待辦事項，建立單次排程。'); textarea.current?.focus(); }}><Clock3 size={14} />也可以試試：「明天早上 9 點，幫我整理專案進度」<ArrowUpRight size={13} /></button></div> : <div className="messages-scroll"><div className="messages">
          {[...(detail?.messages ?? []).map(message => ({ kind: 'message' as const, createdAt: message.createdAt, message })), ...generatedImages.map(image => ({ kind: 'image' as const, createdAt: image.createdAt, image }))].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).map(entry => entry.kind === 'image' ? <article className="message assistant" key={entry.image.id}><span className="assistant-mark"><Code2 size={18} /></span><div className="message-content generated-image"><a href={`/api/sessions/${sessionId}/images/${entry.image.id}`} target="_blank" rel="noreferrer"><img src={`/api/sessions/${sessionId}/images/${entry.image.id}`} alt="Codex 生成的圖片" loading="lazy" /></a><a href={`/api/sessions/${sessionId}/images/${entry.image.id}`} download={entry.image.id}>下載圖片</a></div></article> : <article key={entry.message.id} className={'message ' + entry.message.role}>{entry.message.role === 'assistant' && <span className="assistant-mark"><Code2 size={18} /></span>}<div className="message-content">{entry.message.role === 'assistant' ? <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{entry.message.text}</Markdown> : <><div className="user-text">{entry.message.text}</div>{entry.message.attachments.length > 0 && <MessageAttachments ids={entry.message.attachments} onPreview={setPreview} />}</>}</div></article>)}
          {Object.entries(live).map(([id, text]) => <article className="message assistant streaming" key={id}><span className="assistant-mark"><Code2 size={18} /></span><div className="message-content"><Markdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{text}</Markdown></div></article>)}
          {pendingJob && <div className={'job-status ' + pendingJob.state}>{pendingJob.state === 'waiting_quota' ? <Clock3 size={16} /> : <Loader2 className="spin" size={16} />}<div><strong>{pendingJob.state === 'waiting_quota' ? '進度已保留，等待額度恢復' : activity || stateNames[pendingJob.state]}</strong><small>{pendingJob.state === 'waiting_quota' ? `${date(pendingJob.runAt)} 再次確認額度，恢復後將接續原對話。` : pendingJob.detail}</small></div><button className="text-button" onClick={() => navigate('jobs')}>查看任務<ArrowUpRight size={13} /></button></div>}
          {detail?.jobs.at(-1)?.state === 'needs_review' && <div className="callout"><ShieldCheck size={18} /><div><strong>需要確認上一次進度</strong><p>{detail.jobs.at(-1)?.detail}</p></div></div>}
          <div ref={end} />
        </div></div>}
        <div className={'composer-area ' + (!sessionId ? 'welcome-composer' : '')}>
          {!account?.account && <div className="connect-notice"><span><span className="status-dot" />連接你的 Codex 訂閱帳戶，開始第一個任務</span><button onClick={() => navigate('settings')}>連接帳戶<ArrowUpRight size={14} /></button></div>}
          <form className={"composer " + (dragging ? "dragging" : "")} onSubmit={send} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={dropFiles}>
            {dragging && <div className="drop-hint">放開以上傳檔案（最多 10 個）</div>}
            {(attachments.length > 0 || selectedFeature) && <div className="composer-chips">{selectedFeature && <span className="feature-chip"><Zap size={13} />{selectedFeature.name}<button type="button" onClick={() => setFeatureId('')} aria-label="移除選取功能"><X size={12} /></button></span>}{attachments.map(file => <span className="attachment-chip" key={file.id}><button type="button" className="attachment-preview-button" onClick={() => setPreview(file)} aria-label={`預覽 ${file.name}`}>{/\.(png|jpe?g)$/i.test(file.name) ? <img src={`/api/attachments/${file.id}/preview`} alt="" /> : <File size={16} />}<span>{file.name}</span></button><button type="button" onClick={() => { setAttachments(previous => previous.filter(item => item.id !== file.id)); if (preview?.id === file.id) setPreview(null); }} aria-label={`移除 ${file.name}`}><X size={12} /></button></span>)}</div>}
            <textarea ref={textarea} aria-label="聊天訊息" placeholder={selectedFeature ? `使用「${selectedFeature.name}」，告訴我你的需求…` : '描述你的任務，或問任何問題…'} rows={2} maxLength={100000} value={draft} onChange={event => { setDraft(event.target.value); event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight, 220) + 'px'; }} onKeyDown={keyDown} onPaste={pasteImages} />
            <div className="composer-tools"><div className="composer-tools-left"><button type="button" className="icon-button attach-button" title="附加檔案（最多 10 個，每檔 20 MB）" aria-label="附加檔案" disabled={busy || attachments.length >= 10} onClick={() => fileInput.current?.click()}>{busy ? <Loader2 size={18} className="spin" /> : <Plus size={21} />}</button><input type="file" ref={fileInput} className="sr-only" aria-label="選擇附件" multiple accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.pptx,.ppt,.jpg,.jpeg,.png" onChange={upload} /><span className="tool-divider" /><label className="model-select"><span className="sr-only">選擇模型</span><select disabled={!models.length || isWorking || busy} value={model} onChange={event => { const option = models.find(model => model.model === event.target.value); if (option) void selection({ nextModel: option.model, nextEffort: option.defaultReasoningEffort }); }}><option value="" disabled>選擇模型</option>{models.map(option => <option key={option.model} value={option.model}>{option.displayName}</option>)}</select><ChevronDown size={12} /></label><label className="effort-select"><span className="sr-only">推理強度</span><Sparkles size={13} /><select disabled={isWorking || busy} value={effort} onChange={event => void selection({ nextModel: model, nextEffort: event.target.value })}>{(selectedModel?.supportedReasoningEfforts ?? []).map(option => <option key={option.reasoningEffort} value={option.reasoningEffort}>{option.reasoningEffort}</option>)}</select><ChevronDown size={12} /></label></div><div className="send-tools"><label className="function-select"><span className="sr-only">選取功能</span><select value={featureId} onChange={event => setFeatureId(event.target.value)}><option value="">功能</option>{features.map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}</select><ChevronDown size={12} /></label>{isWorking ? <button type="button" className="send-button stop" onClick={() => void cancel()} aria-label="停止任務"><Square size={15} fill="currentColor" /></button> : <button className="send-button" aria-label="送出訊息" disabled={busy || !draft.trim() || !model || !account?.account}><ArrowUp size={20} /></button>}</div></div>
          </form><div className="composer-footer"><span>{account?.account ? <>Using ChatGPT plan · <a href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noreferrer">Manage usage</a></> : <><ShieldCheck size={11} />檔案與進度保存在你的本機</>}</span><span>{current?.usage ? `${tokens(current.usage.totalTokens)} tokens` : 'Enter 送出 · Shift + Enter 換行'}</span></div>
        </div>
      </div>{filesOpen && sessionId && <ArtifactPanel key={sessionId} sessionId={sessionId} close={() => { setFilesOpen(false); const search = new URLSearchParams(location.search); search.delete('file'); routeNavigate({ pathname: location.pathname, search: search.toString() }, { replace: true }); }} />}</div>;

  return <SWRConfig value={{ onError: (error: Error) => report(error.message) }}><div className="workspace">
    {sidebar && <button className="sidebar-backdrop" onClick={() => setSidebar(false)} aria-label="關閉導覽" />}
    <aside className={'sidebar ' + (sidebar ? 'mobile-open' : '')}>
      <div className="brand-row"><button className="brand" onClick={newChat}><span className="brand-mark"><Code2 size={22} /></span><span>Codex<span className="brand-sub">WORKSPACE</span></span></button><button className="icon-button mobile-close" onClick={() => setSidebar(false)} aria-label="關閉側欄"><PanelLeftClose size={18} /></button><span className="local-badge">LOCAL</span></div>
      <button className="new-chat" onClick={newChat}><Plus size={18} /><span>新增聊天</span><kbd>＋</kbd></button>
      <div className="search-field"><Search size={15} /><input aria-label="搜尋聊天" placeholder="搜尋聊天…" value={search} onChange={event => setSearch(event.target.value)} /><span>⌕</span></div>
      <nav className="main-nav" aria-label="主要導覽"><Link to={routes.commerce} onClick={() => { setSidebar(false); setError(''); }} className={view==='commerce'?'active':''}><BarChart3 size={17}/><span>電商營運台</span><span className="nav-count">NEW</span></Link>{navItems.map(item => <Link to={routes[item.id]} aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'active' : ''} key={item.id} onClick={() => { setSidebar(false); setError(''); }}><item.icon size={17} /><span>{item.label}</span>{item.id === 'features' && <span className="nav-count">{features.length}</span>}</Link>)}</nav>
      <div className="session-heading"><span>最近的聊天</span><button className="icon-button" onClick={newChat} aria-label="新增聊天"><Plus size={14} /></button></div>
      <div className="session-list">{sessions.filter(session => session.title.toLowerCase().includes(search.toLowerCase())).map(session => <Link key={session.id} to={sessionPath(session.id)} title={session.title} aria-current={sessionId === session.id && view === 'chat' ? 'page' : undefined} className={sessionId === session.id && view === 'chat' ? 'active' : ''} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; if (sessionId !== session.id) { setDraft(''); setAttachments([]); } setSidebar(false); setFilesOpen(false); setError(''); }}><MessageSquare size={15} /><span>{session.title}</span>{sessionId === session.id && <span className="session-dot" />}</Link>)}{!sessions.length && <p className="session-empty">每一個開始，都會留在這裡。</p>}</div>
      <div className="sidebar-bottom"><Link to={routes.usage} aria-current={view === 'usage' ? 'page' : undefined} className={view === 'usage' ? 'active' : ''} onClick={() => { setSidebar(false); setError(''); }}><BarChart3 size={17} /><span>用量 Dashboard</span><ArrowUpRight size={14} /></Link><Link to={routes.settings} aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'account-button active' : 'account-button'} onClick={() => { setSidebar(false); setError(''); }}><span className="avatar">{account?.account?.email?.[0]?.toUpperCase() ?? 'P'}</span><span><strong>個人工作空間</strong><small><span className={'status-dot ' + (account?.account ? 'online' : '')} />{account?.account ? 'Codex 已連接' : '尚未連接 Codex'}</small></span><Settings2 size={16} /></Link></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumbs"><button className="icon-button menu-toggle" onClick={() => setSidebar(true)} aria-label="開啟導覽"><Menu size={20} /></button><span className="workspace-label">個人工作空間</span><span className="breadcrumb-slash">/</span><span>{view === 'chat' ? current?.title ?? '新聊天' : navItems.find(item => item.id === view)?.label ?? (view === 'commerce' ? '電商營運台' : view === 'usage' ? '用量 Dashboard' : '帳戶與設定')}</span></div><div className="topbar-actions">{view === 'chat' && <button className="text-button" title="連接本機原始資料夾" onClick={() => void openLocalFolders()}>連接資料夾</button>}{view === 'chat' && sessionId && <button className={'icon-button ' + (filesOpen ? 'selected' : '')} aria-label="工作區檔案" title="開啟檔案與分割預覽" onClick={() => setFilesOpen(!filesOpen)}><FolderOpen size={18} /></button>}<span className="sandbox-label"><span className="status-dot online" />本機沙盒</span><button className="icon-button" onClick={() => navigate('settings')} title="帳戶與設定" aria-label="帳戶與設定"><MoreHorizontal size={20} /></button></div></header>
      {(error || modelError) && <div className="error-banner" role="alert"><span>{error || '無法取得模型目錄，請確認執行器與 Codex 登入。'}</span><button className="icon-button" aria-label="關閉錯誤" onClick={() => setError('')}><X size={16} /></button></div>}
      {localFoldersOpen && sessionId && <LocalFolders key={sessionId} sessionId={sessionId} close={() => setLocalFoldersOpen(false)} />}<Routes>
        <Route path={routes.connections} element={<ConnectionSettings/>}/><Route path={routes.content} element={<ContentWorkbench/>}/><Route path={routes.commerce} element={<Commerce view="overview"/>}/><Route path={routes.products} element={<Commerce view="products"/>}/><Route path={routes.campaigns} element={<Commerce view="campaigns"/>}/><Route path={routes.orders} element={<Commerce view="orders"/>}/><Route path={routes.chat} element={chatPage} />
        <Route path={routes.session} element={chatPage} />
        {managementViews.map(name => <Route key={name} path={routes[name]} element={<Panels key={name} view={name} refresh={refresh} openSession={openSession} report={report} close={() => routeNavigate(lastSession.current ? sessionPath(lastSession.current) : routes.chat)} />} />)}
        <Route path="*" element={<section className="management"><h1>找不到頁面</h1><button className="primary-button" onClick={newChat}>回到新聊天</button></section>} />
      </Routes>
      <footer className="app-footer"><span>CODEX WORKSPACE<span className="footer-dot">·</span>PERSONAL EDITION</span><button onClick={() => void logout()} title="登出工作空間"><LogOut size={12} />登出</button></footer>
    </main>
    {preview && <div className="preview-overlay" onClick={() => setPreview(null)}><section className="preview-dialog" role="dialog" aria-modal="true" aria-label={`預覽 ${preview.name}`} onClick={event => event.stopPropagation()}><header><strong>{preview.name}</strong><button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="關閉預覽"><X size={20} /></button></header>{/\.(png|jpe?g)$/i.test(preview.name) ? <img src={`/api/attachments/${preview.id}/preview`} alt={preview.name} /> : <iframe title={`預覽 ${preview.name}`} src={`/api/attachments/${preview.id}/preview`} />}</section></div>}
  </div></SWRConfig>;
}

/** 顯示聊天歷史附件並可重新開啟預覽。 */
function MessageAttachments({ ids, onPreview }: { ids: string[]; onPreview: (file: Attachment) => void }) {
  const { data } = useSWR<Attachment[]>(`/attachments?ids=${encodeURIComponent(ids.join(','))}`, api);
  return <div className="message-attachments"><Paperclip size={13} />{data ? data.map(file => <button type="button" className="text-button" key={file.id} onClick={() => onPreview(file)}>{file.name}</button>) : `${ids.length} 個附件`}</div>;
}
