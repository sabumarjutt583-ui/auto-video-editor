import type { GraphicSpec, Layer } from "../spec/schema.ts";
import { repairSpec } from "../spec/index.ts";
import { area, centre, inflate, inside, overlap, touches, union, type Box } from "./geometry.ts";

export interface PlaceInput {
  spec: GraphicSpec;
  /** Where the subject is during the graphic (at its start and its end; for a moving camera both). */
  subjects: readonly Box[];
  /** The caption zone, null when captions are off. */
  caption: Box | null;
  /** The area graphics may use. */
  safe: Box;
  /** A smaller, simpler graphic to try when the full one has no room (e.g. a lower third instead of a full card). */
  compact?: GraphicSpec | null;
}

export type PlaceAction = "kept" | "moved" | "shrunk" | "compact" | "skipped";

export interface PlaceResult {
  action: PlaceAction;
  /** The graphic to draw (null when skipped). */
  spec: GraphicSpec | null;
  /** Plain words: what was done and why. */
  reason: string;
  /** How much the graphic was scaled (1 = same size). */
  scale: number;
}

/** Space kept between a graphic and the subject. */
export const SUBJECT_GAP = 0.015;
/** The smallest size a graphic may be shrunk to. */
export const MIN_SCALE = 0.5;
const SCALES = [1, 0.9, 0.8, 0.7, 0.6, MIN_SCALE] as const;
const STEP = 0.01;
/** Layers that cover (almost) the whole frame are the "mood" of the graphic (dim plates, particles) and are not moved. */
const AMBIENT_AREA = 0.85;

const isAmbient = (layer: Layer): boolean => layer.type === "particles" || area(layer.box) >= AMBIENT_AREA;

/** The part of a graphic that has to stay clear of the subject and the captions: all layers except the ambient ones. */
export function mainExtent(spec: GraphicSpec): Box | null {
  return union(spec.layers.filter((l) => !isAmbient(l)).map((l) => l.box));
}

function transformLayer(layer: Layer, from: Box, to: Box, s: number): Layer {
  if (isAmbient(layer)) return layer;
  const box: Box = {
    x: to.x + (layer.box.x - from.x) * s,
    y: to.y + (layer.box.y - from.y) * s,
    w: layer.box.w * s,
    h: layer.box.h * s,
  };
  const moved: Record<string, unknown> = { ...layer, box };
  if ("size" in layer && typeof layer.size === "number") moved.size = layer.size * s;
  return moved as unknown as Layer;
}

/** The same graphic with its main layers scaled by `s` about the top-left of their union and moved to `to`. */
export function movedSpec(spec: GraphicSpec, to: Box, s: number): GraphicSpec | null {
  const from = mainExtent(spec);
  if (!from) return spec;
  const made = repairSpec({ ...spec, layers: spec.layers.map((l) => transformLayer(l, from, to, s)) });
  return made.ok ? made.spec : null;
}

function conflicts(b: Box, obstacles: readonly Box[], caption: Box | null, safe: Box): boolean {
  if (!inside(b, safe)) return true;
  if (caption && touches(b, caption)) return true;
  return obstacles.some((o) => touches(b, o));
}

/** True when the graphic as it is covers neither the subject nor the captions and stays in the safe area. */
export function isClear(spec: GraphicSpec, input: Pick<PlaceInput, "subjects" | "caption" | "safe">): boolean {
  const extent = mainExtent(spec);
  if (!extent) return true;
  return !conflicts(extent, input.subjects.map((s) => inflate(s, SUBJECT_GAP)), input.caption, input.safe);
}

function solve(input: PlaceInput): PlaceResult | null {
  const { spec, subjects, caption, safe } = input;
  const extent = mainExtent(spec);
  if (!extent) return { action: "kept", spec, reason: "nothing to place", scale: 1 };
  const obstacles = subjects.map((s) => inflate(s, SUBJECT_GAP));
  if (!conflicts(extent, obstacles, caption, safe)) return { action: "kept", spec, reason: "it already has a free place", scale: 1 };

  const subjectCentre = obstacles.length > 0 ? centre(union(obstacles) as Box) : null;
  const here = centre(extent);
  let best: { box: Box; scale: number; score: number } | null = null;
  for (const s of SCALES) {
    const w = extent.w * s, h = extent.h * s;
    if (w > safe.w + 1e-9 || h > safe.h + 1e-9) continue;
    for (let y = safe.y; y + h <= safe.y + safe.h + 1e-9; y += STEP) {
      for (let x = safe.x; x + w <= safe.x + safe.w + 1e-9; x += STEP) {
        const box = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w, h };
        if (conflicts(box, obstacles, caption, safe)) continue;
        const c = centre(box);
        let score = 0.8 * Math.hypot(c.x - here.x, c.y - here.y) + 2 * (1 - s);
        // Prefer the side opposite the subject: the farther from it the better.
        if (subjectCentre) score -= 0.35 * Math.hypot(c.x - subjectCentre.x, c.y - subjectCentre.y);
        if (!best || score < best.score - 1e-9) best = { box, scale: s, score };
      }
    }
  }
  if (!best) return null;
  const made = movedSpec(spec, best.box, best.scale);
  if (!made) return null;
  const moved = Math.hypot(best.box.x - extent.x, best.box.y - extent.y) > 1e-6;
  const shrunk = best.scale < 1;
  const sides = [moved ? "moved" : "", shrunk ? `made ${Math.round((1 - best.scale) * 100)} % smaller` : ""].filter(Boolean).join(" and ");
  return { action: shrunk ? "shrunk" : "moved", spec: made, reason: `${sides[0]?.toUpperCase() ?? ""}${sides.slice(1)} to keep the subject and the captions clear`, scale: best.scale };
}

/**
 * Finds the best free place for a graphic: where it is when that is free, otherwise the nearest free place on the side away from the
 * subject, shrinking it (down to half size) when it only fits smaller. With no room at all it is replaced by the compact version
 * when there is one, else skipped (and the reason says why). Same input, same answer.
 */
export function placeGraphic(input: PlaceInput): PlaceResult {
  const full = solve(input);
  if (full) return full;
  if (input.compact) {
    const small = solve({ ...input, spec: input.compact, compact: null });
    if (small) return { ...small, action: "compact", reason: `Replaced by a smaller version: there was no room for the full graphic` };
  }
  return { action: "skipped", spec: null, reason: "Left out: there was no free place that keeps the subject and the captions clear", scale: 1 };
}

/** The overlap, in frame area, between a graphic and the things it must not cover (0 = clear). Used by tests and by quality checks. */
export function coveredArea(spec: GraphicSpec, obstacles: readonly Box[]): number {
  const extent = mainExtent(spec);
  return extent ? obstacles.reduce((sum, o) => sum + overlap(extent, o), 0) : 0;
}
