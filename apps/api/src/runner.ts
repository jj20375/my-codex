/** @file 控制 API 與獨立 runner 的內部橋接，管理 RPC 時限與可重新連線的事件串流。 */
import { config } from './config';
/** 所有 runner 回應必須經呼叫端的協定型別消費。 @param request 內部方法與參數。 @returns RPC result。 */
export async function rpc<T = Record<string, unknown>>(request: { method: string; params?: unknown }): Promise<T> {
  /** 不將共享金鑰傳到瀏覽器。 */
  const response = await fetch(config.RUNNER_URL + (request.method === 'runner/localFile' ? '/local-file' : '/rpc'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-runner-secret': config.RUNNER_SECRET }, body: JSON.stringify(request), signal: AbortSignal.timeout(65_000) });
  /** runner 只會回傳協定結果或安全的錯誤訊息。 */
  const data = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(data.message ?? 'Codex 執行器無法連線');
  return data;
}
/** 訂閱 runner 的原生事件；中斷會交由上層延遲重連。 @param input 事件處理與取消訊號。 @returns 串流完成。 */
export async function subscribe({ onEvent, signal }: { onEvent: (event: Record<string, unknown>) => Promise<void>; signal: AbortSignal }) {
  /** 串流不設固定總時限，只受服務生命週期控制。 */
  const response = await fetch(config.RUNNER_URL + '/events', { headers: { 'x-runner-secret': config.RUNNER_SECRET }, signal });
  if (!response.ok || !response.body) throw new Error('Runner event stream unavailable');
  /** 跨 chunk 保留尚未完整的 SSE 行。 */
  let buffer = '';
  /** UTF-8 解碼器保留跨 chunk 的多位元字元。 */
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    /** 每一行都是單一 JSON 事件，不處理伺服器提供的註解心跳。 */
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      /** 移出一行後保留剩餘片段。 */
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data: ')) await onEvent(JSON.parse(line.slice(6)));
    }
  }
}
