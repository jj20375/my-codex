#!/usr/bin/env node
/** @file 離線 Codex 協定測試替身；清楚以 mock 標記，不能作為真實訂閱用量驗證。 */
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const path = process.env.CODEX_HOME + '/mock-state.json';
let state;
try { state = JSON.parse(readFileSync(path, 'utf8')); } catch { state = { threads: {}, resetAt: 0 }; }
function save() { writeFileSync(path, JSON.stringify(state)); }
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function notify(method, params) { send({ method, params }); }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const { method, id, params = {} } = request;
  if (!method) continue;
  let result = {};
  if (method === 'initialize') result = { userAgent: 'mock-only' };
  else if (method === 'account/read') result = { account: { type: 'chatgpt', email: 'mock@localhost', planType: 'test' }, requiresOpenaiAuth: true };
  else if (method === 'account/rateLimits/read') result = { rateLimits: { limitId: 'codex', primary: { usedPercent: Date.now() < state.resetAt ? 100 : 0, windowDurationMins: 300, resetsAt: state.resetAt / 1000 }, secondary: null } };
  else if (method === 'model/list') result = { data: [{ model: 'mock-codex', displayName: 'Mock Codex（測試替身）', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }], nextCursor: null };
  else if (method === 'thread/start') { const thread = { id: randomUUID(), turns: [], developerInstructions: params.developerInstructions }; state.threads[thread.id] = thread; save(); result = { thread }; }
  else if (method === 'thread/resume' || method === 'thread/read') { const thread = state.threads[params.threadId]; if (params.developerInstructions) thread.developerInstructions = params.developerInstructions; save(); result = { thread }; }
  else if (method === 'turn/interrupt') {
    const thread = state.threads[params.threadId]; const turn = thread.turns.find(turn => turn.id === params.turnId);
    if (turn) { turn.status = 'interrupted'; save(); notify('turn/completed', { threadId: thread.id, turn }); }
  } else if (method === 'turn/start') {
    const thread = state.threads[params.threadId];
    const text = params.input.find(input => input.type === 'text').text;
    const turn = { id: randomUUID(), status: 'inProgress', items: [{ id: randomUUID(), type: 'userMessage', content: [{ type: 'text', text }] }], error: null };
    thread.turns.push(turn); save(); result = { turn };
    notify('turn/started', { threadId: thread.id, turn });
    if (text.includes('LOCAL_FILES_TEST')) setTimeout(() => {
      const connectionId=text.match(/LOCAL_FILES_TEST ([0-9a-f-]{36})/)[1];
      const operations=[{type:'mkdir',from:null,to:'classified',text:null},{type:'move',from:'source.txt',to:'classified/renamed.txt',text:null}];
      for(const action of ['read','propose']){
        const request={id:action+'-'+turn.id,method:'item/tool/call',params:{threadId:thread.id,turnId:turn.id,callId:action+'-'+turn.id,tool:'local_files',namespace:null,arguments:{action,connectionId,path:action==='read'?'source.txt':null,operations:action==='propose'?operations:null}}};
        send(request);if(action==='propose')send(request);
      }
    },50);
    if (text.includes('NATURAL_SCHEDULE_TEST')) setTimeout(() => {
      const request = { id: 'tool-' + turn.id, method: 'item/tool/call', params: { threadId: thread.id, turnId: turn.id, callId: 'call-' + turn.id, tool: 'propose_schedule', namespace: null, arguments: { title: '聊天排程提案（MOCK）', prompt: '來自自然語言工具', runAt: new Date(Date.now() + 60_000).toISOString(), intervalMinutes: null } } };
      send(request); send(request);
    }, 50);
    setTimeout(() => {
      if (text.includes('QUOTA_TEST') && !thread.quotaSeen) {
        thread.quotaSeen = true; state.resetAt = Date.now() + 3500;
        turn.status = 'failed'; turn.error = { message: 'MOCK: quota exhausted', codexErrorInfo: 'usageLimitExceeded' }; save(); notify('turn/completed', { threadId: thread.id, turn });
      } else {
        const item = { id: randomUUID(), type: 'agentMessage', text: 'MOCK：已從同一個 thread 接續並完成任務。' };
        turn.items.push(item); turn.status = 'completed'; save();
        notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: item.id, delta: item.text });
        notify('item/completed', { threadId: thread.id, turnId: turn.id, item });
        const tokenUsage = { total: { totalTokens: 120, inputTokens: 80, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 }, last: { totalTokens: 120 } };
        notify('thread/tokenUsage/updated', { threadId: thread.id, turnId: turn.id, tokenUsage });
        notify('thread/tokenUsage/updated', { threadId: thread.id, turnId: turn.id, tokenUsage });
        notify('turn/completed', { threadId: thread.id, turn });
      }
    }, text.includes('NATURAL_SCHEDULE_TEST') || text.includes('LOCAL_FILES_TEST') ? 1000 : text.includes('CANCEL_TEST') ? 2000 : 250);
  }
  if (id !== undefined) send({ id, result });
}
