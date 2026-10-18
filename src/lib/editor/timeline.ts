import type { MediaFile } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";

/** Index of the scene playing at `time` (the last scene for times at or past the end). */
export function sceneIndexAt(scenes: readonly Scene[], time: number): number {
  if (scenes.length === 0) return -1;
  for (let i = scenes.length - 1; i >= 0; i -= 1) {
    if (time >= (scenes[i]?.start ?? 0)) return i;
  }
  return 0;
}

/** Spacing (seconds) between ruler marks so that marks are at least `minPixels` apart. */
export function rulerStep(pixelsPerSecond: number, minPixels = 70): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  return steps.find((step) => step * pixelsPerSecond >= minPixels) ?? 3600;
}

export const MIN_PIXELS_PER_SECOND = 4;
export const MAX_PIXELS_PER_SECOND = 400;

export function clampZoom(pixelsPerSecond: number): number {
  return Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, pixelsPerSecond));
}

/** A zoom that fits the whole video in `width` pixels. */
export function fitZoom(duration: number, width: number): number {
  return duration > 0 ? clampZoom(width / duration) : 40;
}

/** Swaps the media of two scenes (or moves it, when one of them has none). Returns the new files and map. */
export function swapMedia(
  media: readonly MediaFile[],
  mediaMap: Readonly<Record<string, string>>,
  a: string,
  b: string,
): { media: MediaFile[]; mediaMap: Record<string, string> } {
  if (a === b) return { media: [...media], mediaMap: { ...mediaMap } };
  const pathA = mediaMap[a];
  const pathB = mediaMap[b];
  const next: Record<string, string> = { ...mediaMap };
  delete next[a];
  delete next[b];
  if (pathA !== undefined) next[b] = pathA;
  if (pathB !== undefined) next[a] = pathB;
  const moved = media.map((m) => {
    if (m.path === pathA) return { ...m, sceneId: b, how: "manual" as const, confidence: null };
    if (m.path === pathB) return { ...m, sceneId: a, how: "manual" as const, confidence: null };
    return m;
  });
  return { media: moved, mediaMap: next };
}
