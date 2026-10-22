import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, RenderContext, RenderNote } from "../context.ts";
import type { Pose } from "../anim.ts";
import { resolveColor, WEIGHTS } from "../theme.ts";
import { drawRuns, type Run } from "./label.ts";

type TextLayer = Extract<Layer, { type: "text" }>;
type RichLayer = Extract<Layer, { type: "richText" }>;

/** Text and rich text share one layout: a text is a rich text with one run. */
export function drawTextLike(ctx: Canvas2D, layer: TextLayer | RichLayer, area: Area, pose: Pose, rc: RenderContext, note: (n: RenderNote) => void): void {
  const runs: Run[] =
    layer.type === "text"
      ? [{ text: layer.text, weight: WEIGHTS[layer.weight], color: resolveColor(layer.color, rc.theme) }]
      : layer.runs.map((run) => ({ text: run.text, weight: WEIGHTS[run.weight ?? "regular"], color: resolveColor(run.color ?? layer.runs[0]?.color, rc.theme) }));
  drawRuns(ctx, runs, area, { size: layer.size * rc.height, align: layer.align, maxLines: layer.maxLines, reveal: pose.reveal, layerId: layer.id, shadow: true }, rc, note);
}
