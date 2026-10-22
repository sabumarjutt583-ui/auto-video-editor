import type { MotionGraphic } from "../../../types/editor.ts";

/** Graphic entries without one (the list stays sorted by start). */
export function removeGraphic(list: readonly MotionGraphic[], id: string): MotionGraphic[] {
  return list.filter((g) => g.id !== id);
}

/** Puts a graphic in the list (a graphic with the same id is replaced); sorted by start. */
export function putGraphic(list: readonly MotionGraphic[], graphic: MotionGraphic): MotionGraphic[] {
  return [...list.filter((g) => g.id !== graphic.id), graphic].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** Where a copy of a graphic starts: right after it when there is room in its scene, else as late as it fits. */
export function copyStart(g: Pick<MotionGraphic, "start" | "duration">, scene: { start: number; end: number }): number {
  const latest = scene.end - 0.1 - g.duration;
  return Math.round(Math.max(scene.start, Math.min(g.start + g.duration + 0.1, latest)) * 100) / 100;
}
