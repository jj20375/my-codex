/** @file 在聊天中常駐顯示該 session 的參考資料夾，與管理視窗共用 SWR 快取並提供移除參考入口。 */
import { useState } from 'react';
import useSWR from 'swr';
import { FolderOpen, X } from 'lucide-react';
import { api } from './api';
export interface ReferenceFolder {
  /** 授權識別碼。 */ id: string;
  /** 資料夾名稱。 */ name: string;
  /** 主機實際路徑。 */ root: string;
  /** 讀取或修改權限。 */ mode: 'read'|'readwrite';
}
/** 每個 session 使用獨立查詢鍵，切換聊天不保留上一個聊天的清單。 */
export default function ReferenceFolders({ sessionId, manage }: { /** 目前聊天。 */ sessionId: string; /** 開啟連接管理。 */ manage: () => void }) {
  const key=`/sessions/${sessionId}/local-folders`;
  const { data, error, isLoading, mutate }=useSWR<ReferenceFolder[]>(key,api,{refreshInterval:5000,shouldRetryOnError:false,onError:()=>{}});
  /** 只鎖定正在移除的連接，避免重複提交。 */
  const [removing,setRemoving]=useState<string|null>(null);
  /** 錯誤就地顯示，避免移除失敗後假裝清單已更新。 */
  const [actionError,setActionError]=useState('');
  async function remove(id:string) {
    setRemoving(id);setActionError('');
    try { await api(`${key}/${id}/disconnect`,{method:'POST'});await mutate(); }
    catch(error){setActionError(error instanceof Error?error.message:'移除參考失敗');}
    finally{setRemoving(null);}
  }
  return <section className="reference-folders" aria-label="此聊天的參考資料夾"><header><strong><FolderOpen size={14}/>參考資料夾{data?`（${data.length}）`:''}</strong><button className="text-button" onClick={manage}>新增／管理</button></header>{isLoading&&!data?<p className="reference-status">正在確認此聊天的參考資料夾…</p>:null}{error&&<p className="reference-status" role="status">無法確認連接狀態{data?'，下方為上次取得的清單':''}；請開啟管理檢查主機服務。</p>}{!error&&data?.length===0&&<p className="reference-status">此聊天尚未加入參考資料夾。</p>}{data&&data.length>0&&<ul>{data.map(folder=><li key={folder.id}><button className="reference-folder-info" title={folder.root} onClick={manage}><span><FolderOpen size={13}/><strong>{folder.name}</strong><small>{folder.mode==='read'?'唯讀':'允許修改（需確認）'}</small></span><span className="reference-folder-path">{folder.root}</span></button><button className="icon-button" title="移除參考，不刪除本機檔案" aria-label={`移除參考資料夾 ${folder.name}`} disabled={removing!==null} onClick={()=>void remove(folder.id)}><X size={13}/></button></li>)}</ul>}{actionError&&<p role="alert" className="form-error">{actionError}</p>}</section>;
}
