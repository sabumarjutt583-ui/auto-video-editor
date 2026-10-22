import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, IconShape, RenderContext, RenderNote } from "../context.ts";
import { resolveColor } from "../theme.ts";

type IconLayer = Extract<Layer, { type: "icon" }>;

/** Draws SVG path data as an icon, as large as fits in the box, centred. */
export function drawIconShape(ctx: Canvas2D, shape: IconShape, area: Area, color: string): void {
  const side = Math.min(area.w, area.h);
  const scale = side / shape.viewBox;
  ctx.save();
  ctx.translate(area.x + (area.w - side) / 2, area.y + (area.h - side) / 2);
  ctx.scale(scale, scale);
  if (shape.filled) {
    ctx.fillStyle = color;
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = shape.strokeWidth ?? 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }
  for (const d of shape.paths) {
    const path = new Path2D(d);
    if (shape.filled) ctx.fill(path);
    else ctx.stroke(path);
  }
  if (shape.fillPaths && !shape.filled) {
    ctx.fillStyle = color;
    for (const d of shape.fillPaths) ctx.fill(new Path2D(d));
  }
  ctx.restore();
}

export function drawIcon(ctx: Canvas2D, layer: IconLayer, area: Area, rc: RenderContext, note: (n: RenderNote) => void): void {
  const shape = rc.icon(layer.icon.set, layer.icon.name);
  if (!shape) {
    note({ layerId: layer.id, kind: "missing-icon", message: `Icon ${layer.icon.set}:${layer.icon.name} is not available.` });
    return;
  }
  drawIconShape(ctx, shape, area, resolveColor(layer.color, rc.theme));
}
