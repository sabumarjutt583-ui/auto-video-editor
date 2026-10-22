import type { Density } from "../brand/model.ts";
import type { Trigger } from "./types.ts";
import { sceneScore } from "./detect.ts";

/** Share of the scenes that get a graphic, per density. "Normal" means roughly 30 to 50 %. */
export const DENSITY_RATIO: Record<Density, { min: number; max: number }> = {
  low: { min: 0.1, max: 0.25 },
  normal: { min: 0.3, max: 0.5 },
  high: { min: 0.55, max: 0.75 },
};

/** Most scenes in a row that may have a graphic, per density (the others stay clean so the picture can breathe). */
export const MAX_IN_A_ROW: Record<Density, number> = { low: 1, normal: 2, high: 3 };

/** A scene shorter than this has no room for a graphic. */
export const MIN_SCENE_SECONDS = 1.8;

export interface ScoredScene {
  id: string;
  index: number;
  duration: number;
  triggers: readonly Trigger[];
}

export interface Selection {
  /** Scene ids that may get a graphic, in scene order. */
  chosen: string[];
  /** Why the others stay clean. */
  skipped: Array<{ id: string; reason: "clean" | "too-short" | "density" | "neighbours" }>;
}

/**
 * Chooses the scenes that may get a graphic. Scenes with nothing to show stay clean, short scenes are skipped, the best scenes
 * win when the density allows only some, and long runs of graphics are broken up. Same input, same answer.
 */
export function selectScenes(scenes: readonly ScoredScene[], density: Density): Selection {
  const skipped: Selection["skipped"] = [];
  const eligible: Array<ScoredScene & { score: number }> = [];
  for (const scene of scenes) {
    const score = sceneScore(scene.triggers);
    if (score <= 0) skipped.push({ id: scene.id, reason: "clean" });
    else if (scene.duration < MIN_SCENE_SECONDS) skipped.push({ id: scene.id, reason: "too-short" });
    else eligible.push({ ...scene, score });
  }
  const limit = scenes.length === 0 ? 0 : Math.max(eligible.length > 0 ? 1 : 0, Math.floor(scenes.length * DENSITY_RATIO[density].max));
  const ranked = [...eligible].sort((a, b) => b.score - a.score || a.index - b.index);
  const keep = new Set(ranked.slice(0, limit).map((s) => s.id));
  for (const s of ranked.slice(limit)) skipped.push({ id: s.id, reason: "density" });

  // Break runs: no more than N neighbouring scenes in a row (by scene order), the weakest of a run goes.
  const order = [...scenes].sort((a, b) => a.index - b.index);
  const scoreOf = new Map(eligible.map((s) => [s.id, s.score]));
  const maxRun = MAX_IN_A_ROW[density];
  for (;;) {
    let run: string[] = [];
    let longest: string[] = [];
    for (const scene of order) {
      if (keep.has(scene.id)) {
        run.push(scene.id);
        if (run.length > maxRun && run.length > longest.length) longest = [...run];
      } else run = [];
    }
    if (longest.length === 0) break;
    const weakest = [...longest].sort((a, b) => (scoreOf.get(a) ?? 0) - (scoreOf.get(b) ?? 0) || b.localeCompare(a))[0] as string;
    keep.delete(weakest);
    skipped.push({ id: weakest, reason: "neighbours" });
  }
  return { chosen: order.filter((s) => keep.has(s.id)).map((s) => s.id), skipped };
}
