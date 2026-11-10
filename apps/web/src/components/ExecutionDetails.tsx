/** @file 在任務與用量頁展開執行快照，呈現實際模型、強度及已記錄 token，未知歷史不猜測回填。 */
import { date, type Execution } from './api';

/** 已記錄用量採完整數字，避免縮寫隱藏差異。 */
export default function ExecutionDetails({ executions }: { /** 同一聊天的執行紀錄。 */ executions: Execution[] }) {
  return <details className="execution-details"><summary>模型與用量明細（{executions.length} 次已記錄）</summary><p className="form-hint">用量為開始記錄後收到的官方快照增量，執行期間隨快照更新。舊執行未保存模型與強度；— 代表尚未取得用量。</p>{executions.length ? executions.map(execution => <div className="execution-record" key={execution.id}><div><strong>{execution.model} · {execution.effort}</strong><small>{date(execution.createdAt)} · 第 {execution.attempt} 次嘗試</small></div><p>Token：<strong>{execution.usage?.totalTokens.toLocaleString('zh-TW') ?? '—'}</strong> · 輸入 {execution.usage?.inputTokens.toLocaleString('zh-TW') ?? '—'} / 輸出 {execution.usage?.outputTokens.toLocaleString('zh-TW') ?? '—'}</p>{execution.usage && <small>快取輸入 {execution.usage.cachedInputTokens.toLocaleString('zh-TW')} · 推理輸出 {execution.usage.reasoningOutputTokens.toLocaleString('zh-TW')}（分別包含在輸入／輸出內）</small>}</div>) : <p className="form-hint">尚無執行快照。啟用此功能以前的模型、強度與個別執行用量未記錄。</p>}</details>;
}
