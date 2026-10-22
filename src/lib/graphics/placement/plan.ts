import type { GraphicSpec } from "../spec/schema.ts";
import type { Box } from "./geometry.ts";
import { placeGraphic, type PlaceAction } from "./solver.ts";

/** What placement needs to know about a graphic (the director's `Placed` fits). */
export interface Placeable {
  sceneId: string;
  spec: GraphicSpec;
  /** Seconds from the start of the voice-over. */
  start: number;
  duration: number;
}

export interface PlacementContext {
  caption: Box | null;
  safe: Box;
  /** Where the subject is while this graphic is on screen (several boxes for a moving camera or clip). */
  subjectsFor: (item: Placeable) => readonly Box[];
  /** A smaller version to try when the full graphic has no room. */
  compactFor?: (item: Placeable) => GraphicSpec | null;
}

export interface PlacementNote {
  sceneId: string;
  action: PlaceAction;
  reason: string;
}

/** Places every graphic; the ones that find no room are dropped. Notes say what happened to each (nothing is hidden). */
export function placeAll<T extends Placeable>(items: readonly T[], ctx: PlacementContext): { placed: T[]; notes: PlacementNote[] } {
  const placed: T[] = [];
  const notes: PlacementNote[] = [];
  for (const item of items) {
    const result = placeGraphic({ spec: item.spec, subjects: ctx.subjectsFor(item), caption: ctx.caption, safe: ctx.safe, compact: ctx.compactFor?.(item) ?? null });
    notes.push({ sceneId: item.sceneId, action: result.action, reason: result.reason });
    if (result.spec) placed.push(result.spec === item.spec ? item : { ...item, spec: result.spec });
  }
  return { placed, notes };
}
