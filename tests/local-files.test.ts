/** @file 以暫存資料夾驗證本機檔案授權、待確認變更、資料保留及路徑隔離。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,symlink,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalFiles } from '../scripts/local-files/store.mjs';
test('同聊天實際路徑去重，不因尾斜線、別名或不同權限新增；不同聊天與同名異路徑可獨立參考',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'local-folders-'));try{
    const root=resolve(temp,'a/project');const other=resolve(temp,'b/project');await mkdir(root,{recursive:true});await mkdir(other,{recursive:true});await symlink(root,resolve(temp,'alias'));
    const store=new LocalFiles(resolve(temp,'state'));await store.init();const sessionId=randomUUID();
    const folder=await store.connect({sessionId,path:root,mode:'read'});
    for(const path of [root,root+'/',resolve(temp,'alias')])await assert.rejects(store.connect({sessionId,path,mode:'readwrite'}),/已連接此參考資料夾/);
    assert.equal(store.state.connections.length,1);assert.equal(store.connection({sessionId,connectionId:folder.id}).mode,'read');
    await store.connect({sessionId,path:other,mode:'read'});const otherSession=randomUUID();await store.connect({sessionId:otherSession,path:root,mode:'readwrite'});
    assert.equal((await store.handle('connections',{sessionId})).length,2);assert.equal((await store.handle('connections',{sessionId:otherSession})).length,1);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('既有重複連接重啟後合併，保留變更清單且不提升權限',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'local-folders-'));try{
    const root=resolve(temp,'project');await mkdir(root);const state=resolve(temp,'state');const store=new LocalFiles(state);await store.init();const sessionId=randomUUID();
    const folder=await store.connect({sessionId,path:root,mode:'readwrite'});const duplicate={...folder,id:randomUUID(),mode:'read'};store.state.connections.push(duplicate);
    store.state.plans.push({id:randomUUID(),sessionId,connectionId:duplicate.id,state:'proposed',operations:[],applied:[]});await store.save();
    const restored=new LocalFiles(state);await restored.init();assert.equal(restored.state.connections.length,1);assert.equal(restored.state.connections[0].mode,'read');assert.equal(restored.state.plans[0].connectionId,folder.id);
    const again=new LocalFiles(state);await again.init();assert.equal(again.state.connections.length,1);assert.equal(again.state.plans.length,1);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('唯讀不能修改、不同聊天不能存取、重新啟動保留授權',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'local-files-'));try{
    const root=resolve(temp,'folder');await mkdir(root);await writeFile(resolve(root,'a.txt'),'hello');
    const store=new LocalFiles(resolve(temp,'state'));await store.init();const sessionId=randomUUID();const folder=await store.connect({sessionId,path:root,mode:'read'});const input={sessionId,connectionId:folder.id};
    assert.equal(Buffer.from((await store.read({...input,path:'a.txt'})).data,'base64').toString(),'hello');
    await assert.rejects(store.propose({...input,operations:[{type:'mkdir',to:'new'}]}),/僅允許讀取/);
    await assert.rejects(store.list({...input,sessionId:randomUUID()}),/授權/);
    const restored=new LocalFiles(resolve(temp,'state'));await restored.init();assert.equal((await restored.list(input))[0].name,'a.txt');
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('分類與文字修改必須先確認，防止重複套用並保留備份',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'local-files-'));try{
    const root=resolve(temp,'folder');await mkdir(root);await writeFile(resolve(root,'a.txt'),'hello');
    const store=new LocalFiles(resolve(temp,'state'));await store.init();const sessionId=randomUUID();const folder=await store.connect({sessionId,path:root,mode:'readwrite'});const input={sessionId,connectionId:folder.id};
    const plan=await store.propose({...input,operations:[{type:'mkdir',to:'docs'},{type:'move',from:'a.txt',to:'docs/b.txt'}]});
    assert.equal(await readFile(resolve(root,'a.txt'),'utf8'),'hello');
    assert.equal((await store.apply({sessionId,planId:plan.id})).state,'completed');assert.equal(await readFile(resolve(root,'docs/b.txt'),'utf8'),'hello');
    await assert.rejects(store.apply({sessionId,planId:plan.id}),/已處理/);
    const edit=await store.propose({...input,operations:[{type:'write',to:'docs/b.txt',text:'updated'}]});await store.apply({sessionId,planId:edit.id});
    assert.equal(await readFile(resolve(temp,'state/backups',edit.id,'0'),'utf8'),'hello');assert.equal(await readFile(resolve(root,'docs/b.txt'),'utf8'),'updated');
    await store.handle('disconnect',input);await assert.rejects(store.list(input),/授權/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('拒絕覆寫、檔案變更衝突、symlink 與目錄逃逸',async()=>{
  const temp=await mkdtemp(resolve(tmpdir(),'local-files-'));try{
    const root=resolve(temp,'folder');await mkdir(root);await writeFile(resolve(root,'a.txt'),'hello');await writeFile(resolve(root,'b.txt'),'keep');await writeFile(resolve(temp,'outside.txt'),'outside');
    await symlink(resolve(temp,'outside.txt'),resolve(root,'link.txt'));await symlink(temp,resolve(root,'outside'));
    const store=new LocalFiles(resolve(temp,'state'));await store.init();const sessionId=randomUUID();const folder=await store.connect({sessionId,path:root,mode:'readwrite'});const input={sessionId,connectionId:folder.id};
    for(const path of ['../outside.txt',resolve(temp,'outside.txt'),'link.txt','outside/outside.txt'])await assert.rejects(store.read({...input,path}));
    await assert.rejects(store.propose({...input,operations:[{type:'move',from:'a.txt',to:'b.txt'}]}),/目的位置已存在/);
    const plan=await store.propose({...input,operations:[{type:'move',from:'a.txt',to:'c.txt'}]});await writeFile(resolve(root,'a.txt'),'external edit');
    assert.equal((await store.apply({sessionId,planId:plan.id})).state,'failed');assert.equal(await readFile(resolve(root,'a.txt'),'utf8'),'external edit');
    assert.equal(await readFile(resolve(root,'b.txt'),'utf8'),'keep');
  }finally{await rm(temp,{recursive:true,force:true});}
});
