/** @file 驗證官方額度的恢復時刻、未知值與錯誤分類，確保不誤用五小時或 token 數推估。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotaRetryAt, isQuotaError } from '../apps/api/src/quota';
const now = 1_800_000_000_000;
test('同一模型的兩個耗盡視窗採較晚恢復時刻', () => {
  assert.equal(quotaRetryAt({ now, model: 'a', limits: { rateLimits: { primary: { usedPercent: 100, resetsAt: now / 1000 + 10 }, secondary: { usedPercent: 100, resetsAt: now / 1000 + 60 } } } })?.getTime(), now + 65_000);
});
test('無恢復時間則五分鐘後確認，不假裝知道恢復時間', () => {
  assert.equal(quotaRetryAt({ now, model: 'a', limits: { rateLimits: { primary: { usedPercent: 100 } } } })?.getTime(), now + 300_000);
});
test('不被其他模型或已過期的視窗阻擋', () => {
  assert.equal(quotaRetryAt({ now, model: 'a', limits: { rateLimitsByLimitId: { a: { normalModelSlug: 'a', primary: { usedPercent: 100, resetsAt: now / 1000 - 1 } }, b: { normalModelSlug: 'b', primary: { usedPercent: 100, resetsAt: now / 1000 + 500 } } } } }), null);
});
test('未知額度保持未知，不解讀成用完', () => assert.equal(quotaRetryAt({ now, model: 'a', limits: {} }), null));
test('只有明確限額錯誤能自動等待，授權及其他錯誤不重試', () => {
  assert.equal(isQuotaError('usageLimitExceeded'), true); assert.equal(isQuotaError('rateLimitExceeded'), true);
  for (const code of ['unauthorized', 'other', 'badRequest', { httpConnectionFailed: { httpStatusCode: 429 } }]) assert.equal(isQuotaError(code), false);
});
