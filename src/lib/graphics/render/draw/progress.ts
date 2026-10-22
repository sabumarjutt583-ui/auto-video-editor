import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { isRtlText } from "../script.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, lerp, phase, withAlpha } from "./common.ts";
import { drawLabel } from "./label.ts";
import { roundedRect } from "./path.ts";

type ProgressLayer = Extract<Layer, { type: "progressBar" }>;

/** A bar that fills from `from` to `to`, with a label on the left and the percentage on the right. */
export function drawProgress(ctx: Canvas2D, layer: ProgressLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const p = phase(timing.local, 0.1, Math.max(0.4, Math.min(1.6, timing.length * 0.6)), "easeOut");
  const value = lerp(layer.from, layer.to, p);
  const textH = area.h * 0.5;
  const barH = Math.max(4, Math.min(area.h * 0.34, area.h - textH));
  const barY = area.y + area.h - barH;
  const size = Math.max(8, Math.min(textH / 1.25, rc.height * 0.05));
  const fill = resolveColor(layer.color, rc.theme, "accent");
  const text = resolveColor("text", rc.theme);
  const percentW = layer.showPercent ? size * 3.2 : 0;
  const rtl = layer.label !== undefined && isRtlText(layer.label);
  if (layer.label) drawLabel(ctx, layer.label, { x: rtl ? area.x + percentW : area.x, y: area.y, w: area.w - percentW, h: textH }, { size, weight: 700, color: text, align: rtl ? "right" : "left", valign: "middle", shadow: true }, layer.id, rc, note);
  if (layer.showPercent) {
    drawLabel(ctx, `${Math.round(value * 100)}%`, { x: rtl ? area.x : area.x + area.w - percentW, y: area.y, w: percentW, h: textH }, { size, weight: 700, color: text, align: rtl ? "left" : "right", valign: "middle", shadow: true, minScale: 1 }, layer.id, rc, note);
  }
  ctx.save();
  roundedRect(ctx, area.x, barY, area.w, barH, barH / 2);
  ctx.fillStyle = withAlpha(resolveColor("secondary", rc.theme), 0.9);
  ctx.fill();
  ctx.clip();
  const filled = area.w * Math.max(0, Math.min(1, value));
  if (filled > 0.5) {
    const width = Math.max(filled, barH);
    roundedRect(ctx, rtl ? area.x + area.w - width : area.x, barY, width, barH, barH / 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.restore();
}
