/** @file 對 HTTP、模型工具輸入與附件清單使用相同驗證規則，避免前端限制被繞過。 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
/** 所有 session 與附件 ID 採 UUID，拒絕路徑字元。 */
export const identifier = z.uuid();
/** 顯示模型必須由官方 model/list 再次驗證。 */
export const sessionInput = z.object({ title: z.string().trim().min(1).max(100), model: z.string().min(1).max(100), effort: z.string().min(1).max(20) }).strict();
/** 每個 turn 限十個附件，重複 ID 視為無效。 */
export const jobInput = z.object({ prompt: z.string().trim().min(1).max(100_000), featureId: identifier.optional(), attachments: z.array(identifier).max(10).refine(ids => new Set(ids).size === ids.length).default([]) }).strict();
export const featureInput = z.object({ name: z.string().trim().min(1).max(100), prompt: z.string().trim().min(1).max(30_000) }).strict();
/** 排程由 agent 提案、使用者確認後啟用；所有時間均為含時區 ISO。 */
export const scheduleInput = z.object({ title: z.string().trim().min(1).max(100), prompt: z.string().trim().min(1).max(30_000), runAt: z.iso.datetime({ offset: true }), intervalMinutes: z.number().int().min(5).max(525600).nullable().default(null) }).strict();
/** 將 Zod 錯誤轉成穩定且可供 UI 顯示的業務錯誤。 @param input schema 及資料。 @returns 驗證後資料。 */
export function parse<T>({ schema, value }: { schema: z.ZodType<T>; value: unknown }): T {
  /** 統一驗證外部輸入，不洩漏完整 request。 */
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ message: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'), errorCode: 'INVALID_INPUT' });
  return result.data;
}
