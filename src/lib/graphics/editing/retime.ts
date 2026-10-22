export interface TimeLimits {
  /** The scene the graphic belongs to. */
  scene: { start: number; end: number };
  /** Moments to snap to (word starts and ends, seconds). */
  points: readonly number[];
}

export const MIN_GRAPHIC_SECONDS = 1.2;
export const END_MARGIN = 0.1;
/** A dragged edge snaps to a word boundary when it is this close (seconds). */
export const SNAP_SECONDS = 0.15;

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function snapTime(time: number, points: readonly number[], tolerance = SNAP_SECONDS): number {
  let best = time, distance = tolerance;
  for (const p of points) if (Math.abs(p - time) <= distance + 1e-9) { best = p; distance = Math.abs(p - time); }
  return best;
}

/** Word starts and ends of the words inside a scene, sorted. */
export function wordPoints(words: ReadonlyArray<{ start: number; end: number }>, scene: { start: number; end: number }): number[] {
  const out = new Set<number>([scene.start]);
  for (const w of words) if (w.end >= scene.start && w.start <= scene.end) { out.add(r2(w.start)); out.add(r2(w.end)); }
  return [...out].sort((a, b) => a - b);
}

/**
 * Moves one edge of a graphic. The edge snaps to a word boundary, the graphic stays inside its scene (and ends before the next
 * picture), and it never gets shorter than 1.2 s.
 */
export function retime(current: { start: number; duration: number }, edge: "start" | "end", time: number, limits: TimeLimits): { start: number; duration: number } {
  const first = limits.scene.start;
  const last = limits.scene.end - END_MARGIN;
  const end = current.start + current.duration;
  const t = snapTime(time, limits.points);
  if (edge === "start") {
    const start = Math.min(Math.max(t, first), end - MIN_GRAPHIC_SECONDS);
    return { start: r2(start), duration: r2(end - start) };
  }
  const to = Math.max(Math.min(t, last), current.start + MIN_GRAPHIC_SECONDS);
  return { start: current.start, duration: r2(Math.min(to, last) - current.start) };
}

/** Moves the whole graphic (the pointer moved by `delta` seconds), snapping its start or end to a word boundary and keeping it inside the scene. */
export function shift(current: { start: number; duration: number }, delta: number, limits: TimeLimits): { start: number; duration: number } {
  const first = limits.scene.start;
  const last = limits.scene.end - END_MARGIN;
  let start = current.start + delta;
  const a = snapTime(start, limits.points);
  const b = snapTime(start + current.duration, limits.points);
  start = a !== start ? a : b !== start + current.duration ? b - current.duration : start;
  start = Math.min(Math.max(start, first), last - current.duration);
  return { start: r2(Math.max(first, start)), duration: current.duration };
}
