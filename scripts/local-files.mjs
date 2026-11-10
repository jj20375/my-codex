/** @file 執行於主機的檔案橋接服務；容器只透過金鑰及 session 授權讀寫，不提供 shell 或任意 RPC。 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalFiles } from './local-files/store.mjs';
const root=resolve(import.meta.dirname,'..');
const text=await readFile(process.env.LOCAL_FILES_ENV??resolve(root,'.env'),'utf8');
const settings=Object.fromEntries(text.split(/\r?\n/).filter(row=>row&&!row.startsWith('#')).map(row=>{const index=row.indexOf('=');return [row.slice(0,index),row.slice(index+1)];}));
const secret=settings.LOCAL_FILES_SECRET;if(!secret||secret.length<32)throw Error('請先執行 scripts/configure.mjs 建立本機檔案服務金鑰');
const store=new LocalFiles(process.env.LOCAL_FILES_STATE_DIR??resolve(root,'.runtime/local-files'));await store.init();
let queue=Promise.resolve();
createServer((request,response)=>{
  const supplied=request.headers['x-local-files-secret'];
  if(request.headers.origin||typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))){response.writeHead(401).end();return;}
  queue=queue.then(async()=>{
    try{
      if(request.method!=='POST'||request.url!=='/rpc')throw Error('無效請求');
      const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>2*1024*1024)throw Error('請求過大');chunks.push(chunk);}
      const {method,input}=JSON.parse(Buffer.concat(chunks).toString());
      if(!input||!/^[0-9a-f-]{36}$/.test(input.sessionId??''))throw Error('無效聊天');
      let result;
      if(method==='pick'){
        const options={timeout:120000,maxBuffer:65536};let selected;
        if(process.platform==='darwin')selected=await promisify(execFile)('osascript',['-e','POSIX path of (choose folder with prompt "選擇要連接到 Codex 的資料夾")'],options);
        else if(process.platform==='win32')selected=await promisify(execFile)('powershell.exe',['-NoProfile','-STA','-Command','Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq "OK") { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }'],options);
        else selected=await promisify(execFile)('zenity',['--file-selection','--directory','--title=選擇要連接到 Codex 的資料夾'],options);
        const path=selected.stdout.trim();if(!path)throw Error('未選取資料夾');result=await store.connect({...input,path});
      }else result=await store.handle(method,input);
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify(result));
    }catch(error){response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({message:error.message}));}
  }).catch(()=>{response.writeHead(500).end();});
}).listen(Number(settings.LOCAL_FILES_PORT??3042),settings.LOCAL_FILES_HOST??(process.platform==='linux'?'0.0.0.0':'127.0.0.1'),()=>console.log('本機檔案服務已啟動'));
