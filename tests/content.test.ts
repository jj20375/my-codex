/** @file 草稿協定拒絕不明欄位與過大結果，來源指紋反映規格修改。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contentSchema,emptyContent,sourceFingerprint,contentPrompt} from '../apps/api/src/content-schema';
test('模型結果拒絕額外欄位、超量標籤與錯誤型別',()=>{
  assert.ok(contentSchema.safeParse(emptyContent).success);
  for(const value of [{...emptyContent,price:980},{...emptyContent,hashtags:Array(31).fill('#水晶')},{...emptyContent,facebook:{html:'<script>'}}])assert.equal(contentSchema.safeParse(value).success,false);
});
test('商品指紋穩定且規格價格改變會失效',()=>{
  const product={name:'手鍊',priceCents:98000,facts:'手圍16cm',audience:'送禮'};
  assert.equal(sourceFingerprint(product),sourceFingerprint({...product}));
  assert.notEqual(sourceFingerprint(product),sourceFingerprint({...product,facts:'手圍18cm'}));
  assert.notEqual(sourceFingerprint(product),sourceFingerprint({...product,priceCents:100000}));
});
test('修訂沿用完整草稿協定與分類限制',()=>{
  const prompt=contentPrompt({product:{name:'永生花'},category:'flower',purpose:'送禮',content:emptyContent,instruction:'縮短 FB'});
  assert.ok(prompt.includes('content-draft.json'));assert.ok(prompt.includes('手鍊才有手圍指南'));assert.ok(prompt.includes('縮短 FB'));assert.ok(prompt.includes('不對外發布'));
});
