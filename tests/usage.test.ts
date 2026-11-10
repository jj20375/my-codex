/** @file 確保累積快照不重複計算，也不把舊 session 首次讀到的歷史標成今日用量。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageDelta } from '../apps/api/src/usage';
const first = { totalTokens: 100, inputTokens: 60, outputTokens: 40, cachedInputTokens: 10, reasoningOutputTokens: 5 };
const next = { totalTokens: 150, inputTokens: 90, outputTokens: 60, cachedInputTokens: 15, reasoningOutputTokens: 7 };
test('新 session 記錄第一次用量', () => assert.deepEqual(usageDelta({ previous: null, current: first, baseline: false }), first));
test('舊 session 首次快照只當基準', () => assert.equal(usageDelta({ previous: null, current: first, baseline: true }), null));
test('相同或過期快照不重複記錄', () => { assert.equal(usageDelta({ previous: first, current: first, baseline: false }), null); assert.equal(usageDelta({ previous: next, current: first, baseline: false }), null); });
test('新的快照只記增加量', () => assert.deepEqual(usageDelta({ previous: first, current: next, baseline: false }), { totalTokens: 50, inputTokens: 30, outputTokens: 20, cachedInputTokens: 5, reasoningOutputTokens: 2 }));
