/** @file 可攜式商品圖片契約：只交換實際 JPG／PNG 位元組，不讀取包內網址；先驗證再上傳。 */
export interface PortableImage {/** 顯示檔名。 */name:string;/** 圖片類型。 */mimeType:'image/png'|'image/jpeg';/** 編碼內容。 */base64:string;/** 整檔雜湊。 */sha256:string;/** 替代文字。 */alt:string}
export const imageByteLimit=5*1024*1024;
/** 產生 SHA-256，不使用可猜的檔名作為去重依據。 */
export async function imageHash(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
/** 在瀏覽器內檢查內容標頭；真正儲存端仍需再次驗證。 */
function imageMime(bytes:Uint8Array){if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';if([137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte))return 'image/png';throw new Error('只支援內容正確的 JPG／PNG 圖片');}
/** 每包最多十圖、每張5 MiB，同一雜湊不可重複。 */
export async function decodeImages(value:unknown):Promise<Array<{file:File;image:PortableImage}>>{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>10)throw new Error('商品圖最多十張');
  const result:Array<{file:File;image:PortableImage}>=[];const seen=new Set<string>();
  for(const entry of value){
    const item=entry as PortableImage;
    if(!item||typeof item.name!=='string'||item.name.length>255||typeof item.alt!=='string'||item.alt.length>300||!['image/png','image/jpeg'].includes(item.mimeType)||typeof item.base64!=='string'||item.base64.length>Math.ceil(imageByteLimit/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('商品圖片格式或大小不正確');
    const bytes=Uint8Array.from(atob(item.base64),char=>char.charCodeAt(0));
    if(!bytes.length||bytes.length>imageByteLimit||imageMime(bytes)!==item.mimeType||await imageHash(bytes)!==item.sha256)throw new Error('圖片內容與雜湊不符');
    if(seen.has(item.sha256))throw new Error('工作包含有重複圖片');seen.add(item.sha256);
    const name=item.name.replace(/[\\/\x00-\x1f]/g,'_').replace(/\.[^.]*$/,'')+(item.mimeType==='image/png'?'.png':'.jpg');
    result.push({file:new File([bytes],name,{type:item.mimeType}),image:item});
  }
  return result;
}
/** 由使用者選定的實際檔案建立圖片包；不用短效 URL 當永久來源。 */
export async function encodeImage(file:File,alt:string):Promise<PortableImage>{
  if(file.size>imageByteLimit)throw new Error('商品交換圖每張上限5 MiB');
  const bytes=new Uint8Array(await file.arrayBuffer());const mimeType=imageMime(bytes);let binary='';
  for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return {name:file.name,mimeType,base64:btoa(binary),sha256:await imageHash(bytes),alt:alt.slice(0,300)};
}
