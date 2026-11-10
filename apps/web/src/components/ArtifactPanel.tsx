/** @file 聊天右側的唯讀檔案樹與分割預覽；選取檔案保存在網址，Markdown 安全渲染，HTML 使用隔離 iframe。 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, FileText, FolderOpen, X } from 'lucide-react';
import { api } from './api';
import CodePreview from './CodePreview';

interface Artifact { /** 工作區相對路徑。 */ path: string; /** 檔案大小。 */ size: number }
/** 路徑逐段編碼，保留靜態資源的相對資料夾關係。 */
function previewUrl({ sessionId, path }: { sessionId: string; path: string }) { return `/api/sessions/${sessionId}/preview/${path.split('/').map(encodeURIComponent).join('/')}`; }
/** 由有限檔案清單建構可展開的資料夾，不列出依賴及隱藏檔。 */
function FileTree({ files, prefix = '', selected, select }: { /** 已列出的檔案。 */ files: Artifact[]; /** 當前資料夾前綴。 */ prefix?: string; /** 選取檔案。 */ selected: string; /** 點選處理。 */ select: (path: string) => void }) {
  const names = [...new Set(files.filter(file => file.path.startsWith(prefix)).map(file => file.path.slice(prefix.length).split('/')[0]))].sort();
  return <ul className="artifact-tree">{names.map(name => {
    const path = prefix + name;
    const folder = files.some(file => file.path.startsWith(path + '/'));
    return <li key={path}>{folder ? <details open><summary><FolderOpen size={13} />{name}</summary><FileTree files={files} prefix={path + '/'} selected={selected} select={select} /></details> : <button type="button" title={path} aria-pressed={selected === path} onClick={() => select(path)}><FileText size={13} /><span>{name}</span></button>}</li>;
  })}</ul>;
}
/** 選取檔案時顯示文字、文件或靜態網頁預覽，私人資料仍需擁有者 cookie。 */
export default function ArtifactPanel({ sessionId, close }: { /** 原聊天。 */ sessionId: string; /** 關閉分割視窗。 */ close: () => void }) {
  const [search, setSearch] = useSearchParams();
  const selected = search.get('file') ?? '';
  /** 網頁／Markdown 可切換預覽與原始碼。 */
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const { data: files = [], error: listError } = useSWR<Artifact[]>(`/sessions/${sessionId}/artifacts`, api, { refreshInterval: 5000 });
  const extension = selected.split('.').at(-1)?.toLowerCase() ?? '';
  const binary = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf'].includes(extension);
  const html = ['html', 'htm'].includes(extension);
  const markdown = ['md', 'markdown'].includes(extension);
  const { data: content, error: contentError, isLoading } = useSWR<{ text: string }>(selected && !binary ? `/sessions/${sessionId}/content?path=${encodeURIComponent(selected)}` : null, api, { refreshInterval: 5000 });
  const url = previewUrl({ sessionId, path: selected });
  function select(path: string) { const next = new URLSearchParams(search); next.set('file', path); setSearch(next); setMode('preview'); }
  return <aside className="artifact-workbench" aria-label="工作區分割預覽"><header><h2>工作區檔案</h2><button className="icon-button" aria-label="關閉分割預覽" onClick={close}><X size={16} /></button></header><div className="artifact-workbench-body"><nav aria-label="專案資料夾"><p className="form-hint">最多列出 200 個檔案、5 層資料夾；隱藏檔與 node_modules 不列出。</p>{listError && <p role="alert">{listError.message}</p>}{files.length ? <FileTree files={files} selected={selected} select={select} /> : <p className="form-hint">產出的檔案會顯示在這裡。</p>}</nav><section className="artifact-viewer">{selected ? <><div className="artifact-toolbar"><strong title={selected}>{selected}</strong><a href={`/api/sessions/${sessionId}/download?path=${encodeURIComponent(selected)}`} download title="下載檔案" aria-label="下載檔案"><ArrowDown size={16} /></a></div>{(html || markdown) && <div className="artifact-modes"><button aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>預覽</button><button aria-pressed={mode === 'source'} onClick={() => setMode('source')}>原始碼</button></div>}{html && mode === 'preview' ? <><p className="form-hint">靜態 HTML 預覽，支援相對圖片與 CSS，不執行 JavaScript。動態專案需另行啟動服務。</p><iframe title={`網頁預覽：${selected}`} src={url} sandbox="allow-same-origin" referrerPolicy="no-referrer" /></> : binary ? extension === 'pdf' ? <iframe title={`PDF 預覽：${selected}`} src={url} sandbox="allow-same-origin" /> : <img className="artifact-image" src={url} alt={selected} /> : contentError ? <p role="alert">{contentError.message}</p> : isLoading ? <p>正在讀取…</p> : markdown && mode === 'preview' ? <div className="message-content artifact-markdown"><Markdown remarkPlugins={[remarkGfm]}>{content?.text ?? ''}</Markdown></div> : <CodePreview text={content?.text ?? ''} extension={extension} />}</> : <div className="artifact-placeholder"><FolderOpen size={30} /><p>選擇檔案，在這裡查看結果。</p><small>Markdown、程式碼、靜態 HTML、圖片與 PDF</small></div>}</section></div></aside>;
}
