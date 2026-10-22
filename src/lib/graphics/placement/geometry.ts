/** A rectangle in fractions of the frame (0..1), like the boxes of a GraphicSpec. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FRAME: Box = { x: 0, y: 0, w: 1, h: 1 };

export const area = (b: Box): number => Math.max(0, b.w) * Math.max(0, b.h);

/** Area shared by two boxes. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export const touches = (a: Box, b: Box): boolean => overlap(a, b) > 1e-9;

export function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Grows (or shrinks, when negative) a box on all sides, kept inside the frame. */
export function inflate(b: Box, by: number): Box {
  const x = Math.max(0, b.x - by);
  const y = Math.max(0, b.y - by);
  return { x, y, w: Math.min(1, b.x + b.w + by) - x, h: Math.min(1, b.y + b.h + by) - y };
}

export const inside = (inner: Box, outer: Box, eps = 1e-6): boolean =>
  inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;

export const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Clamps a box into the frame (a box that is too big is shrunk). */
export function clampBox(b: Box): Box {
  const w = Math.min(1, Math.max(0, b.w));
  const h = Math.min(1, Math.max(0, b.h));
  return { x: Math.min(1 - w, Math.max(0, b.x)), y: Math.min(1 - h, Math.max(0, b.y)), w, h };
}

/** Intersection over union of two boxes (1 = the same box). */
export function iou(a: Box, b: Box): number {
  const shared = overlap(a, b);
  const total = area(a) + area(b) - shared;
  return total > 0 ? shared / total : 0;
}
