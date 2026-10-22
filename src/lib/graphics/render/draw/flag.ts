import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { resolveColor } from "../theme.ts";
import type { DrawEnv } from "./common.ts";
import { drawFlagPicture } from "./geo.ts";
import { drawLabel } from "./label.ts";

type FlagLayer = Extract<Layer, { type: "flag" }>;

/** A country flag (a rounded rectangle or a disc) with an optional label under it. */
export function drawFlag(ctx: Canvas2D, layer: FlagLayer, area: Area, env: DrawEnv): void {
  const { rc, note } = env;
  const flag = rc.flag?.(layer.country);
  const w = (flag as { width?: number } | undefined)?.width ?? 0;
  const h = (flag as { height?: number } | undefined)?.height ?? 0;
  if (!flag || w <= 0 || h <= 0) {
    note({ layerId: layer.id, kind: "missing-flag", message: `The flag of ${layer.country} could not be loaded.` });
    return;
  }
  const labelH = layer.label ? area.h * 0.22 : 0;
  const pictureArea = { x: area.x, y: area.y, w: area.w, h: area.h - labelH };
  drawFlagPicture(ctx, flag as CanvasImageSource & { width: number; height: number }, pictureArea, layer.shape);
  if (layer.label) {
    drawLabel(ctx, layer.label, { x: area.x, y: area.y + pictureArea.h, w: area.w, h: labelH }, { size: Math.min(labelH / 1.25, rc.height * 0.05), weight: 700, color: resolveColor("text", rc.theme), align: "center", valign: "middle", shadow: true }, layer.id, rc, note);
  }
}
