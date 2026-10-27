import type { CaptionLine } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";

/** Applies per-scene caption overrides: a caption line that overlaps a scene with an
 * override shows the override text for that span (word timings stay the line's own).
 * Lines with no override are returned unchanged. */
export function applyCaptionOverrides(
  lines: readonly CaptionLine[],
  scenes: readonly Scene[],
  overrides: Readonly<Record<string, string>> | undefined,
): CaptionLine[] {
  if (!overrides) return [...lines];
  return lines.map((line) => {
    let best: Scene | null = null;
    let bestOverlap = 0;
    for (const scene of scenes) {
      const overlap = Math.min(line.end, scene.end) - Math.max(line.start, scene.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = scene;
      }
    }
    if (!best) return line;
    const text = (overrides[best.id] ?? "").trim();
    if (text === "") return line;
    return { ...line, text, words: [{ text, start: line.start, end: line.end }], breakAt: null };
  });
}
