import type { Canvas2D, RenderContext, RenderNote } from "../../../lib/graphics/render/context";
import { frameCount } from "../../../lib/graphics/render/timing";
import { renderFrame } from "../../../lib/graphics/render/renderFrame";
import type { GraphicSpec } from "../../../lib/graphics/spec";

/** Shares of the graphic's length at which it is drawn to see what the renderer had to cut or shrink. */
export const FRAME_RATE_NOTES_AT = [0.35, 0.7, 0.95] as const;

/** What went wrong while drawing a graphic at a few moments (text cut, picture missing ...). Same input, same notes. */
export function notesOf(spec: GraphicSpec, ctx: Canvas2D, rc: RenderContext): RenderNote[] {
  const total = frameCount(spec.duration);
  const seen = new Map<string, RenderNote>();
  for (const share of FRAME_RATE_NOTES_AT) {
    const frame = Math.min(total - 1, Math.round(total * share));
    for (const note of renderFrame(spec, frame, ctx, rc).notes) seen.set(`${note.layerId}:${note.kind}`, note);
  }
  return [...seen.values()];
}
