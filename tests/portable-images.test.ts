/** @file 圖片工作包驗證真實位元組、大小與 SHA，拒絕網址／重複／偽裝內容。 */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {encodeImage,decodeImages} from '../apps/web/src/components/portableImages';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9n8AAAAASUVORK5CYII=','base64');
test('PNG 工作包可還原檔案且雜湊穩定',async()=>{const image=await encodeImage(new File([png],'商品.png',{type:'image/png'}),'商品主圖');const decoded=await decodeImages([image]);assert.equal(decoded[0].file.type,'image/png');assert.deepEqual(Buffer.from(await decoded[0].file.arrayBuffer()),png);assert.equal(decoded[0].image.alt,'商品主圖');});
test('拒絕損壞、偽裝 MIME、超量及重複圖片',async()=>{const image=await encodeImage(new File([png],'商品.png'),'主圖');for(const value of [[{...image,sha256:'0'.repeat(64)}],[{...image,mimeType:'image/jpeg'}],[image,image],Array(11).fill(image),[{url:'http://localhost/private'}]])await assert.rejects(()=>decodeImages(value));await assert.rejects(()=>encodeImage(new File([new Uint8Array(2*1024*1024+1)],'big.png'),'大圖'));});
