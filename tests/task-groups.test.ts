/** @file 驗證同一聊天不因多輪對話或排程執行而被重複計算。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTasks, groupTasks } from '../apps/web/src/components/taskGroups';
test('同一 session 多次執行只算一個任務', () => {
  const jobs = [{ sessionId: 'a', state: 'completed' }, { sessionId: 'a', state: 'completed' }, { sessionId: 'b', state: 'completed' }];
  assert.equal(countTasks(jobs), 2);
  assert.equal(groupTasks(jobs).length, 2);
});
test('保留同 session 尚未完成的執行作為取消目標', () => {
  const jobs = [{ sessionId: 'a', state: 'completed', id: 'new' }, { sessionId: 'a', state: 'waiting_quota', id: 'active' }];
  assert.equal(groupTasks(jobs)[0].id, 'active');
});
test('沒有進行中執行時採用最新紀錄', () => {
  const jobs = [{ sessionId: 'a', state: 'failed', id: 'latest' }, { sessionId: 'a', state: 'completed', id: 'older' }];
  assert.equal(groupTasks(jobs)[0].id, 'latest');
});
