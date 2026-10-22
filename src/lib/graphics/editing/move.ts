import { area, inside, touches, union, type Box } from "../placement/geometry.ts";
import { mainExtent, movedSpec, SUBJECT_GAP } from "../placement/solver.ts";
import { inflate } from "../placement/geometry.ts";
import type { GraphicSpec } from "../spec/schema.ts";

export interface MoveLimits {
  /** The area graphics may use (the frame without the margins). */
  safe: Box;
  /** The caption zone: a graphic can never be dragged into it. */
  caption: Box | null;
  /** Subject boxes; dragging over them is allowed but reported (the quality check warns). */
  subjects?: readonly Box[];
}

/** A drag snaps to the edges of the safe area and to the middle lines when it comes this close (fractions of the frame). */
export const SNAP = 0.015;

function snapped(value: number, targets: readonly number[]): number {
  let best = value, distance = SNAP;
  for (const t of targets) if (Math.abs(value - t) < distance) { best = t; distance = Math.abs(value - t); }
  return best;
}

function fits(box: Box, limits: MoveLimits): boolean {
  return inside(box, limits.safe) && !(limits.caption && touches(box, limits.caption));
}

/**
 * The box a dragged graphic ends up in: where the pointer wants it (`wanted`), pulled into the safe area, snapped to its edges and
 * the middle lines, and never inside the caption zone: when the wish would enter it, the graphic slides along one axis or stays where it was.
 */
export function dragTarget(from: Box, wanted: Box, limits: MoveLimits): Box {
  const { safe } = limits;
  const clamp = (b: Box): Box => ({ ...b, x: Math.min(safe.x + safe.w - b.w, Math.max(safe.x, b.x)), y: Math.min(safe.y + safe.h - b.h, Math.max(safe.y, b.y)) });
  let box = clamp(wanted);
  box = clamp({
    ...box,
    x: snapped(box.x, [safe.x, safe.x + safe.w - box.w, 0.5 - box.w / 2]),
    y: snapped(box.y, [safe.y, safe.y + safe.h - box.h, 0.5 - box.h / 2]),
  });
  if (fits(box, limits)) return box;
  const alongX = { ...box, y: from.y };
  const alongY = { ...box, x: from.x };
  const candidates = [alongX, alongY].filter((c) => fits(c, limits));
  if (candidates.length === 0) return fits(from, limits) ? from : box;
  // Of the two slides, the one that keeps the graphic closer to where the pointer is.
  return candidates.sort((a, b) => Math.hypot(a.x - wanted.x, a.y - wanted.y) - Math.hypot(b.x - wanted.x, b.y - wanted.y))[0] as Box;
}

/** The graphic moved so that its main part starts at `target`'s corner (same size). Null when the graphic has nothing to move. */
export function moveTo(spec: GraphicSpec, target: Box): GraphicSpec | null {
  const extent = mainExtent(spec);
  return extent ? movedSpec(spec, { ...target, w: extent.w, h: extent.h }, 1) : null;
}

/** Drag by (dx, dy) fractions of the frame from the graphic's current place. Returns the moved graphic (or the same one when it cannot move). */
export function dragGraphic(spec: GraphicSpec, dx: number, dy: number, limits: MoveLimits): GraphicSpec {
  const extent = mainExtent(spec);
  if (!extent) return spec;
  const target = dragTarget(extent, { ...extent, x: extent.x + dx, y: extent.y + dy }, limits);
  return moveTo(spec, target) ?? spec;
}

export { area, inflate, union, SUBJECT_GAP };
