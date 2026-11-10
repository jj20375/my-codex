/** @file 以已授權草稿附件產生圖片工作包，固定 UUID 路徑、大小及簽章均由後端驗證。 */
import {BadRequestException} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Attachment} from './db';
import {config} from './config';
import {validSignature} from './files';
/** 只讀取圖片附件；每次一張，避免一次讀取全部大檔。 */
export async function attachmentImage(file:Attachment){
  if(!['.png','.jpg','.jpeg'].includes(file.extension)||file.size>5*1024*1024)throw new BadRequestException('商品交換圖只支援每張5 MiB以內的 JPG／PNG');
  const bytes=await readFile(resolve(config.UPLOAD_DIR,file.id+file.extension));
  if(bytes.length>5*1024*1024||!validSignature({name:file.id+file.extension,header:bytes.subarray(0,8)}))throw new BadRequestException('圖片內容不正確');
  return {name:file.name,mimeType:file.extension==='.png'?'image/png':'image/jpeg',base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};
}
