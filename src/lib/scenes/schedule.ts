import type { SceneTimingRange } from "../../types/project.ts";

export const DEFAULT_TIMING_RANGES: SceneTimingRange[] = [
  { startSeconds: 0, targetSeconds: 3 },
  { startSeconds: 60, targetSeconds: 5 },
  { startSeconds: 300, targetSeconds: 8 },
  { startSeconds: 900, targetSeconds: 10 },
];

export function validTimingRanges(value: unknown): SceneTimingRange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return [];
  const rows: SceneTimingRange[] = [];
  for (const item of value) {
    if (!item || !Number.isFinite(item.startSeconds) || !Number.isFinite(item.targetSeconds)
      || item.startSeconds < 0 || item.targetSeconds < 1 || item.targetSeconds > 60
      || (rows.length === 0 ? item.startSeconds !== 0 : item.startSeconds <= rows[rows.length - 1].startSeconds)) return [];
    rows.push({ startSeconds: item.startSeconds, targetSeconds: item.targetSeconds });
  }
  return rows;
}
