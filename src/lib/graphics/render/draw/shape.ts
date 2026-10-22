import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, RenderContext } from "../context.ts";
import { resolveColor } from "../theme.ts";
import { roundedRect } from "./path.ts";

type ShapeLayer = Extract<Layer, { type: "shape" }>;

export function drawShape(ctx: Canvas2D, layer: ShapeLayer, area: Area, rc: RenderContext): void {
  const fill = layer.fill === undefined && layer.stroke === undefined ? resolveColor("primary", rc.theme) : layer.fill !== undefined ? resolveColor(layer.fill, rc.theme) : undefined;
  const stroke = layer.stroke !== undefined ? resolveColor(layer.stroke, rc.theme) : undefined;
  const lineWidth = Math.max(0, layer.strokeWidth * rc.height);
  if (layer.shape === "line") {
    ctx.beginPath();
    ctx.moveTo(area.x, area.y + area.h / 2);
    ctx.lineTo(area.x + area.w, area.y + area.h / 2);
    ctx.lineCap = "round";
    ctx.strokeStyle = stroke ?? fill ?? resolveColor("primary", rc.theme);
    ctx.lineWidth = lineWidth > 0 ? lineWidth : Math.max(2, rc.height * 0.004);
    ctx.stroke();
    return;
  }
  if (layer.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(area.x + area.w / 2, area.y + area.h / 2, area.w / 2, area.h / 2, 0, 0, Math.PI * 2);
  } else {
    roundedRect(ctx, area.x, area.y, area.w, area.h, layer.shape === "rect" ? 0 : layer.radius * Math.min(area.w, area.h));
  }
  if (fill !== undefined) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke !== undefined && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}
