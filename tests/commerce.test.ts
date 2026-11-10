/** @file 電商統計只計已付款訂單，零分母不提供虛構比例。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commerceMetrics } from '../apps/api/src/commerce-metrics';
import { parseOrderCsv } from '../apps/web/src/components/orderCsv';
test('CSV 支援引號與正確金額分，拒絕不明商品與無效日期',()=>{const products=[{id:'p',name:'商品,甲'}];const header='number,product,campaign,quantity,total,status,date\r\n';const rows=parseOrderCsv({text:header+'A,"商品,甲",,2,123.45,paid,2026-11-02',products,campaigns:[]});assert.equal(rows[0].totalCents,12345);assert.equal(rows[0].campaignId,null);assert.throws(()=>parseOrderCsv({text:header+'A,未知,,1,1,paid,2026-11-02',products,campaigns:[]}));assert.throws(()=>parseOrderCsv({text:header+'A,"商品,甲",,1,1,paid,2026-02-30',products,campaigns:[]}));});
test('無成效資料時比例與客單價未知',()=>{const result=commerceMetrics({orders:[],spendCents:0,visits:0});assert.equal(result.conversion,null);assert.equal(result.roas,null);assert.equal(result.averageCents,null);assert.equal(result.revenueCents,0);});
test('排除退款取消與未付款，金額維持整數分',()=>{const result=commerceMetrics({orders:[{status:'paid',totalCents:12345},{status:'paid',totalCents:10001},{status:'refunded',totalCents:5000},{status:'pending',totalCents:10000},{status:'cancelled',totalCents:6000}],spendCents:10000,visits:100});assert.equal(result.revenueCents,22346);assert.equal(result.averageCents,11173);assert.equal(result.paidOrders,2);assert.equal(result.pendingOrders,1);assert.equal(result.refundOrders,1);assert.equal(result.conversion,.02);assert.equal(result.roas,2.2346);});
