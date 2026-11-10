/** @file 本機資料夾授權與待確認變更；僅在選定根目錄內讀寫，不跟隨符號連結。 */
import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath, open, link, unlink, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

/** 資料由本機服務持有，Docker 僅持有隨機 connection ID。 */
export class LocalFiles {
  constructor(directory) { this.directory = directory; this.state = { connections: [], plans: [] }; }
  async init() { await mkdir(this.directory,{recursive:true,mode:0o700}); try { this.state=JSON.parse(await readFile(resolve(this.directory,'state.json'),'utf8')); this.deduplicateConnections(); for(const plan of this.state.plans)if(plan.state==='applying'){plan.state='needs_review';plan.error='服務在套用途中停止，請依已完成紀錄檢查原檔，不會自動重播';} await this.save(); } catch(error) { if(error.code!=='ENOENT') throw error; } }
  /** 同一聊天依真實路徑或檔案系統識別去重，保留清單歷史且不擴大寫入權限。 */
  deduplicateConnections() {
    const unique=[];
    for(const connection of this.state.connections){
      const existing=unique.find(row=>row.sessionId===connection.sessionId&&(row.root===connection.root||connection.inode>0&&row.device===connection.device&&row.inode===connection.inode));
      if(!existing){unique.push(connection);continue;}
      if(connection.mode==='read')existing.mode='read';
      for(const plan of this.state.plans)if(plan.sessionId===connection.sessionId&&plan.connectionId===connection.id)plan.connectionId=existing.id;
    }
    this.state.connections=unique;
  }
  async save() { const file=resolve(this.directory,'state.json'); await writeFile(file+'.tmp',JSON.stringify(this.state),{mode:0o600}); await rename(file+'.tmp',file); }
  connection({sessionId,connectionId}) { const connection=this.state.connections.find(row=>row.id===connectionId&&row.sessionId===sessionId); if(!connection)throw Error('找不到已授權資料夾');return connection; }
  async connect({sessionId,path,mode}) {
    if(!/^[0-9a-f-]{36}$/.test(sessionId)||!['read','readwrite'].includes(mode)||typeof path!=='string'||!isAbsolute(path))throw Error('無效的連接設定');
    const root=await realpath(path);if(dirname(root)===root||!(await lstat(root)).isDirectory())throw Error('請選擇一般資料夾');
    const info=await lstat(root);
    if(this.state.connections.some(row=>row.sessionId===sessionId&&(row.root===root||info.ino>0&&row.device===info.dev&&row.inode===info.ino)))throw Error('這個聊天已連接此參考資料夾，請勿重複加入；如需更改權限，請先中斷連接後重新加入');
    const connection={id:randomUUID(),sessionId,name:basename(root),root,mode,device:info.dev,inode:info.ino};
    this.state.connections.push(connection);await this.save();return connection;
  }
  /** 拒絕絕對路徑、父目錄逃逸及所有中間符號連結，並檢查根目錄未被替換。 */
  async path(connection,path,{missing=false}={}) {
    if(typeof path!=='string'||path.length>1000||path.includes('\0')||isAbsolute(path)||path.split(/[\\/]/).includes('..'))throw Error('無效的相對路徑');
    const root=await lstat(connection.root);if(!root.isDirectory()||root.isSymbolicLink()||root.dev!==connection.device||root.ino!==connection.inode||await realpath(connection.root)!==connection.root)throw Error('原資料夾已移動或替換，請重新連接');
    const target=resolve(connection.root,path);const rel=relative(connection.root,target);if(rel.startsWith('..')||isAbsolute(rel))throw Error('路徑超出授權資料夾');
    let current=connection.root;
    for(const part of rel.split(/[\\/]/).filter(Boolean)){current=resolve(current,part);try{if((await lstat(current)).isSymbolicLink())throw Error('不支援符號連結');}catch(error){if(missing&&error.code==='ENOENT')continue;throw error;}}
    return target;
  }
  async list(input) {
    const connection=this.connection(input);const directory=await this.path(connection,input.path??'');const entries=await readdir(directory,{withFileTypes:true});
    return entries.filter(row=>!row.name.startsWith('.')&&!row.isSymbolicLink()).slice(0,500).map(row=>({name:row.name,type:row.isDirectory()?'directory':'file'}));
  }
  async read(input) {
    const connection=this.connection(input);const target=await this.path(connection,input.path);const file=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
    try { const info=await file.stat();if(!info.isFile()||info.size>20*1024*1024)throw Error('單檔讀取上限為 20 MB');const data=await file.readFile();return {name:basename(target),data:data.toString('base64')}; }finally{await file.close();}
  }
  async fingerprint(path) { const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink>1||info.size>20*1024*1024)throw Error('變更只支援 20 MB 以內、沒有硬連結的一般檔案');return createHash('sha256').update(await readFile(path)).digest('hex'); }
  async propose(input) {
    const connection=this.connection(input);if(connection.mode!=='readwrite')throw Error('此資料夾僅允許讀取');
    if(input.planId&&!/^[0-9a-f-]{36}$/.test(input.planId))throw Error('無效的清單識別碼');
    if(!Array.isArray(input.operations)||!input.operations.length||input.operations.length>100)throw Error('每次最多 100 項變更');
    const operations=[];const sources=new Set();const destinations=new Set();
    for(const operation of input.operations){
      if(!['move','mkdir','write'].includes(operation.type)||typeof operation.to!=='string'||!operation.to)throw Error('不支援此操作');
      const to=await this.path(connection,operation.to,{missing:true});if(to===connection.root||destinations.has(to))throw Error('目的位置重複');destinations.add(to);
      const exists=await lstat(to).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(operation.type!=='write'&&exists)throw Error('目的位置已存在，不會覆寫');
      if(operation.type==='move'){
        const from=await this.path(connection,operation.from);if(sources.has(from)||destinations.has(from)||sources.has(to))throw Error('變更存在重複或循環路徑');sources.add(from);
        operations.push({type:'move',from:operation.from,to:operation.to,hash:await this.fingerprint(from)});
      }else if(operation.type==='write'){
        if(typeof operation.text!=='string'||Buffer.byteLength(operation.text)>1024*1024)throw Error('文字修改上限為 1 MB');
        operations.push({type:'write',to:operation.to,text:operation.text,hash:exists?await this.fingerprint(to):null});
      }else operations.push({type:'mkdir',to:operation.to});
    }
    const plan={id:input.planId??randomUUID(),sessionId:input.sessionId,connectionId:connection.id,state:'proposed',operations,applied:[],createdAt:new Date().toISOString()};
    const existing=this.state.plans.find(row=>row.id===plan.id);if(existing)return existing;
    this.state.plans.push(plan);await this.save();return plan;
  }
  /** 只有擁有者 HTTP 路由能呼叫；模型工具無套用能力。部分失敗保留已完成紀錄，不自動重播。 */
  async apply({sessionId,planId}) {
    const plan=this.state.plans.find(row=>row.id===planId&&row.sessionId===sessionId);if(!plan||plan.state!=='proposed')throw Error('此清單已處理或不存在');
    const connection=this.connection(plan);if(connection.mode!=='readwrite')throw Error('資料夾不允許修改');
    plan.state='applying';await this.save();
    try {
      for(const operation of plan.operations){
        const to=await this.path(connection,operation.to,{missing:true});
        if(operation.type==='mkdir')await mkdir(to);
        else if(operation.type==='move'){
          const from=await this.path(connection,operation.from);if(await this.fingerprint(from)!==operation.hash)throw Error('來源內容已變更，請重新產生清單');
          /** link 採原子 no-clobber，避免 rename 覆寫既有檔案；同一授權檔案系統內移動。 */
          await link(from,to);await unlink(from);
        }else {
          const exists=await lstat(to).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
          if(operation.hash===null&&exists||operation.hash!==null&&(!exists||await this.fingerprint(to)!==operation.hash))throw Error('檔案已變更，請重新產生清單');
          if(exists){const backup=resolve(this.directory,'backups',plan.id);await mkdir(backup,{recursive:true,mode:0o700});await copyFile(to,resolve(backup,String(plan.applied.length)));}
          await writeFile(to,operation.text,{flag:exists?'w':'wx'});
        }
        plan.applied.push({type:operation.type,from:operation.from,to:operation.to});await this.save();
      }
      plan.state='completed';
    }catch(error){plan.state='failed';plan.error=error.message;}
    await this.save();return plan;
  }
  async handle(method,input){
    if(method==='connect')return this.connect(input);
    if(method==='connections')return this.state.connections.filter(row=>row.sessionId===input.sessionId);
    if(method==='plans')return this.state.plans.filter(row=>row.sessionId===input.sessionId);
    if(method==='disconnect'){this.connection(input);this.state.connections=this.state.connections.filter(row=>row.id!==input.connectionId);await this.save();return {success:true};}
    if(method==='list')return this.list(input);
    if(method==='read')return this.read(input);
    if(method==='propose')return this.propose(input);
    if(method==='apply')return this.apply(input);
    if(method==='reject'){const plan=this.state.plans.find(row=>row.id===input.planId&&row.sessionId===input.sessionId);if(!plan||plan.state!=='proposed')throw Error('此清單已處理或不存在');plan.state='rejected';await this.save();return plan;}
    throw Error('不支援此方法');
  }
}
