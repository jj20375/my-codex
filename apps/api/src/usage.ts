/** @file 計算官方累積用量快照的增量，防止重送或舊快照造成重複計數。 */
export function usageDelta({ previous, current, baseline }: { previous: Record<string, number> | null; current: Record<string, number>; baseline: boolean }) {
  const keys = ['totalTokens', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens'] as const;
  if (!keys.every(key => Number.isSafeInteger(current[key]) && current[key] >= 0)) return null;
  if (previous && keys.some(key => current[key] < (previous[key] ?? 0))) return null;
  if (baseline && !previous) return null;
  const delta: Record<string, number> = {};
  for (const key of keys) delta[key] = current[key] - (previous?.[key] ?? 0);
  return delta.totalTokens > 0 ? delta : null;
}
