/** @file 在主機背景啟動本機檔案服務；重新啟動電腦後可再次執行，不重複啟動存活程序。 */
import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdir,open } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');const directory=resolve(root,'.runtime/local-files');await mkdir(directory,{recursive:true,mode:0o700});
const pidFile=resolve(directory,'service.pid');
try{const pid=Number(await readFile(pidFile,'utf8'));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);console.log('本機檔案服務已在執行');process.exit(0);}}catch{}
const log=await open(resolve(directory,'service.log'),'a',0o600);
const child=spawn(process.execPath,[resolve(root,'scripts/local-files.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
await writeFile(pidFile,String(child.pid),{mode:0o600});child.unref();await log.close();console.log('已啟動本機檔案服務');
