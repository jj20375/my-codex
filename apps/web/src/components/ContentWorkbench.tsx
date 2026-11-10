/** @file 商品內容工作台：以擁有者 API 保存草稿、共用附件與 Codex 聊天，安全預覽而不直接上架。 */
import {useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import useSWR from 'swr';
import ReactMarkdown from 'react-markdown';
import {ConnectedDelivery} from './ConnectedCommerce';
import {api,stateNames,type ModelOption,type Attachment,type Job} from './api';
import {sessionPath} from './routes';
/** 所有文字欄位以 React 跳脫或安全 Markdown 顯示。 */
const labels={title:'商品名稱',summary:'商品簡介',description:'商品詳情',seoTitle:'SEO 標題',seoDescription:'SEO 描述',facebook:'Facebook',instagram:'Instagram',threads:'Threads',line:'LINE'};
type Content=Record<keyof typeof labels,string>&{/** 候選標籤。 */hashtags:string[];/** 待確認項目。 */warnings:string[]};
interface Draft {/** 版本。 */revision:number;/** 類型。 */category:string;/** 情境。 */purpose:string;/** 內容。 */content:Content;/** 附件。 */attachments:string[];/** 聊天。 */sessionId:string|null}
interface Data {/** coBuy 回寫來源。 */source?:{system:string;tenantId:number;commodityId:number;fingerprint:string}|null;/** 商品事實。 */product:{id:string;name:string;priceCents:number;facts:string;audience:string};/** 可選草稿。 */draft:Draft|null}
const blank:Content={title:'',summary:'',description:'',seoTitle:'',seoDescription:'',facebook:'',instagram:'',threads:'',line:'',hashtags:[],warnings:[]};
export default function ContentWorkbench(){
  const {productId}=useParams();
  const path=`/commerce/products/${productId}/content`;
  const {data,error,mutate}=useSWR<Data>(path,api,{revalidateOnFocus:false});
  if(error)return <section className="management"><p role="alert">{error.message}</p><Link to="/commerce/products">回商品列表</Link></section>;
  if(!data)return <section className="management">載入商品內容…</section>;
  return <Editor key={`${productId}-${data.draft?.revision??0}`} data={data} path={path} refresh={async()=>{await mutate();}}/>;
}
/** 版本切換才重新初始化表單；背景任務輪詢不覆寫使用者正在輸入的內容。 */
function Editor({data,path,refresh}:{/** 當前資料。 */data:Data;/** API 路徑。 */path:string;/** 重讀草稿。 */refresh:()=>Promise<void>}){
  /** 編輯狀態只在明確保存或重新載入時更新。 */
  const [content,setContent]=useState(data.draft?.content??blank);
  const [revision,setRevision]=useState(data.draft?.revision??0);
  const [category,setCategory]=useState(data.draft?.category??'other');
  const [purpose,setPurpose]=useState(data.draft?.purpose??'');
  const [attachmentIds,setAttachmentIds]=useState<string[]>(data.draft?.attachments??[]);
  const [exportImages,setExportImages]=useState<Array<{id:string;alt:string}>>([]);
  const [busy,setBusy]=useState(false);const [dirty,setDirty]=useState(false);const [message,setMessage]=useState('');
  /** 選中的通路決定預覽，不影響保存其他欄位。 */
  const [preview,setPreview]=useState<keyof typeof labels>('description');
  const [model,setModel]=useState('');const [effort,setEffort]=useState('');const [instruction,setInstruction]=useState('');
  const {data:models=[]}=useSWR<ModelOption[]>('/models',api);
  const selected=models.find(row=>row.model===model)??models.find(row=>row.isDefault)??models[0];
  const sessionId=data.draft?.sessionId;
  const {data:chat}=useSWR<{jobs:Job[]}>(sessionId?`/sessions/${sessionId}`:null,api,{refreshInterval:3000});
  const {data:attachments=[]}=useSWR<Attachment[]>(attachmentIds.length?`/attachments?ids=${attachmentIds.join(',')}`:null,api);
  const active=chat?.jobs.some(job=>['queued','dispatching','running','waiting_quota'].includes(job.state));
  const latest=chat?.jobs.at(-1);
  /** 附件數在送出前及後端雙重限制；支援選檔、拖放和剪貼簿圖片。 */
  async function upload(files:File[]){
    if(busy||!files.length)return;
    if(attachmentIds.length+files.length>10){setMessage('每份商品草稿最多十個附件');return;}
    setBusy(true);setMessage('');
    try{const form=new FormData();files.forEach(file=>form.append('files',file));const rows=await api<Attachment[]>('/attachments',{method:'POST',body:form});setAttachmentIds([...attachmentIds,...rows.map(row=>row.id)]);setDirty(true);}catch(error){setMessage(error instanceof Error?error.message:'上傳失敗');}finally{setBusy(false);}
  }
  async function downloadImages(){setBusy(true);setMessage('');try{const value=await api(path+'/export',{method:'POST',body:JSON.stringify({revision,images:exportImages})});const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='商品內容與圖片.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setMessage(error instanceof Error?error.message:'匯出失敗');}finally{setBusy(false);}}
  /** 保存後才建立生成工作；生成和匯入都有伺服器版本檢查。 */
  async function action(kind:'save'|'generate'|'import'){
    setBusy(true);setMessage('');
    try{
      if(kind==='import'){
        if(dirty&&!window.confirm('載入 AI 結果將取代尚未保存的修改，是否繼續？'))return;
        await api(path+'/import',{method:'POST',body:JSON.stringify({revision})});
      }else{
        const saved=await api<Draft>(path,{method:'PUT',body:JSON.stringify({revision,category,purpose,content,attachments:attachmentIds})});
        setRevision(saved.revision);setDirty(false);
        if(kind==='generate'){
          if(!selected)throw new Error('模型目錄尚未載入');
          await api(path+'/generate',{method:'POST',body:JSON.stringify({revision:saved.revision,model:selected.model,effort:effort||selected.defaultReasoningEffort,instruction})});
        }
      }
      setDirty(false);await refresh();
    }catch(error){setMessage(error instanceof Error?error.message:'操作失敗');}finally{setBusy(false);}
  }
  return <section className="management content-workbench" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void upload(Array.from(event.dataTransfer.files));}} onPaste={event=>{const files=Array.from(event.clipboardData.items).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(files.length){event.preventDefault();void upload(files);}}}>
    <header className="commerce-heading"><div><div className="eyebrow">PRODUCT CONTENT STUDIO</div><h1>{data.product.name}</h1><p>商品、SEO 與社群共用一份資料。{dirty?'有尚未保存的修改':`草稿版本 ${data.draft?.revision??1}`}。</p></div><Link to="/commerce/products" className="text-button" onClick={event=>{if(dirty&&!window.confirm('尚有未保存修改，確定離開？'))event.preventDefault();}}>回商品列表</Link></header>
    {message&&<p role="alert" className="content-notice">{message}</p>}
    <div className="content-grid"><aside className="commerce-card commerce-form"><h2>本次工作資料</h2><p className="content-facts">{data.product.facts}</p><small>客群：{data.product.audience}</small><label>商品類型<select value={category} onChange={event=>{setCategory(event.target.value);setDirty(true);}}><option value="other">其他／待分類</option><option value="bracelet">水晶手鍊</option><option value="flower">永生花／生命樹</option><option value="crystal">晶柱／原礦</option></select></label><label>用途與檔期<textarea rows={3} maxLength={3000} value={purpose} onChange={event=>{setPurpose(event.target.value);setDirty(true);}} placeholder="例如：送貓咪愛好者的入厝禮；未確認優惠就不填。"/></label>
    <label className="text-button">加入參考檔案（{attachmentIds.length}/10）<input type="file" multiple disabled={busy} accept=".pdf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={event=>{void upload(Array.from(event.target.files??[]));event.target.value='';}}/></label><small>也可以拖入檔案，或直接貼上圖片。</small>
    {attachments.map(file=><div className="content-attachment" key={file.id}><a href={`/api/attachments/${file.id}/preview`} target="_blank" rel="noreferrer">{file.name}</a>{/\.(png|jpe?g)$/i.test(file.name)&&<label><input type="checkbox" checked={exportImages.some(row=>row.id===file.id)} onChange={event=>setExportImages(event.target.checked?[...exportImages,{id:file.id,alt:content.title||data.product.name}]:exportImages.filter(row=>row.id!==file.id))}/>加入回傳商品圖</label>}<button type="button" disabled={busy} aria-label={`移除 ${file.name}`} onClick={()=>{setAttachmentIds(attachmentIds.filter(id=>id!==file.id));setDirty(true);}}>移除</button></div>)}
    <small>保存草稿後，勾選要回傳的商品圖；每張上限5 MiB。</small><button className="text-button" disabled={busy||dirty||!data.draft||!exportImages.length} onClick={()=>void downloadImages()}>下載含選定圖片工作包（{exportImages.length} 張）</button>
    <label>生成模型<select value={selected?.model??''} onChange={event=>{setModel(event.target.value);setEffort('');}}>{models.map(row=><option key={row.model} value={row.model}>{row.displayName}</option>)}</select></label><label>推理強度<select value={effort||selected?.defaultReasoningEffort||''} onChange={event=>setEffort(event.target.value)}>{selected?.supportedReasoningEfforts.map(row=><option key={row.reasoningEffort}>{row.reasoningEffort}</option>)}</select></label><label>本次對話調整<textarea value={instruction} maxLength={5000} onChange={event=>setInstruction(event.target.value)} placeholder="改成入厝送禮角度，FB 短一點，保留商品名稱。"/></label>
    <button className="primary-button" disabled={busy||active||!selected} onClick={()=>void action('generate')}>保存並交給 AI 製作</button>
    {sessionId&&<><Link className="text-button" to={sessionPath(sessionId)}>開啟商品專用對話 →</Link><p role="status">{latest?stateNames[latest.state]??latest.state:'正在讀取任務'} {latest?.detail}</p><button className="text-button" disabled={busy||active||latest?.state!=='completed'} onClick={()=>void action('import')}>載入已完成的 AI 結果</button></>}
    </aside><div className="commerce-card commerce-form"><h2>編輯內容草稿</h2>{(Object.keys(labels) as (keyof typeof labels)[]).map(key=><label key={key}>{labels[key]}<textarea rows={key==='description'?8:3} value={content[key]} maxLength={key==='description'?20000:key==='title'||key==='seoTitle'?200:key==='seoDescription'?1000:key==='summary'?3000:key==='threads'||key==='line'?5000:10000} onChange={event=>{setContent({...content,[key]:event.target.value});setDirty(true);}}/></label>)}
    <label>候選 Hashtag（每行一個）<textarea rows={3} value={content.hashtags.join('\n')} onChange={event=>{setContent({...content,hashtags:event.target.value.split('\n')});setDirty(true);}}/></label><label>待確認事項（每行一項）<textarea rows={4} value={content.warnings.join('\n')} onChange={event=>{setContent({...content,warnings:event.target.value.split('\n')});setDirty(true);}}/></label>
    <button className="primary-button" disabled={busy} onClick={()=>void action('save')}>儲存草稿</button><a className="text-button" download="商品內容草稿.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({schemaVersion:1,kind:'cobuy-content',source:data.source??null,productId:data.product.id,category,purpose,content},null,2))}>匯出目前內容 JSON</a></div>
    <aside className="commerce-card content-preview"><h2>內容預覽</h2><label>預覽項目<select value={preview} onChange={event=>setPreview(event.target.value as keyof typeof labels)}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{preview==='description'?<ReactMarkdown>{content.description||'尚無商品詳情'}</ReactMarkdown>:<p className="content-facts">{content[preview]||'尚無內容'}</p>}{preview==='seoTitle'&&<p>{content.seoDescription}</p>}<h3>候選標籤</h3><p>{content.hashtags.filter(Boolean).join(' ')||'尚無標籤'}</p><h3>發布前待確認</h3><ul>{content.warnings.filter(Boolean).map((text,index)=><li key={index}>{text}</li>)}</ul><small>這裡保存的是草稿；尚未修改商城或對外發布。</small></aside></div>
    <ConnectedDelivery productId={data.product.id} revision={revision} images={exportImages} disabled={dirty||busy||!data.draft} content={content} refresh={refresh}/>
  </section>;
}
