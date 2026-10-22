import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, phase, withAlpha, withLayerAlpha } from "./common.ts";
import { drawLabel } from "./label.ts";

type TimelineLayer = Extract<Layer, { type: "timeline" }>;

/** Events on a line that draws itself; each event appears when the line reaches it. Horizontal labels alternate above and below. */
export function drawTimeline(ctx: Canvas2D, layer: TimelineLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const n = layer.events.length;
  const accent = resolveColor("accent", rc.theme);
  const primary = resolveColor("primary", rc.theme);
  const text = resolveColor("text", rc.theme);
  const muted = resolveColor("muted", rc.theme);
  const progress = phase(timing.local, 0.1, Math.max(0.6, Math.min(1.8, timing.length * 0.6)), "easeInOut");
  const dot = Math.max(5, Math.min(rc.height * 0.014, 14));
  const horizontal = layer.orientation === "horizontal";
  const along = (i: number): number => (n === 1 ? 0.5 : i / (n - 1));
  const lineWidth = Math.max(3, rc.height * 0.007);

  if (horizontal) {
    const y = area.y + area.h / 2;
    const x0 = area.x + area.w * 0.06;
    const x1 = area.x + area.w * 0.94;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = withAlpha(muted, 0.35);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = primary;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + (x1 - x0) * progress, y);
    ctx.stroke();
    ctx.restore();
    const slot = ((x1 - x0) / Math.max(1, n - 1)) * 2;
    const size = Math.max(8, Math.min(rc.height * 0.048, slot * 0.22, area.h * 0.13));
    layer.events.forEach((event, i) => {
      const x = x0 + (x1 - x0) * along(i);
      const appear = phase(timing.local, 0.1 + Math.max(0.6, Math.min(1.8, timing.length * 0.6)) * along(i), 0.35, "easeOutBack");
      const reached = progress >= along(i) - 1e-6;
      if (!reached) return;
      const up = i % 2 === 0;
      withLayerAlpha(ctx, appear, () => {
        ctx.beginPath();
        ctx.arc(x, y, dot * (0.6 + 0.4 * appear), 0, Math.PI * 2);
        ctx.fillStyle = i === n - 1 ? accent : primary;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = resolveColor("background", rc.theme);
        ctx.stroke();
        const boxW = Math.min(slot * 0.95, area.w * 0.4);
        const bx = Math.max(area.x, Math.min(area.x + area.w - boxW, x - boxW / 2));
        // The date sits next to the dot, the label beyond it.
        const dateH = event.date ? size * 1.35 : 0;
        const near = dot * 1.8;
        const labelH = area.h / 2 - near - dateH;
        if (event.date) drawLabel(ctx, event.date, { x: bx, y: up ? y - near - dateH : y + near, w: boxW, h: dateH }, { size: size * 1.1, weight: 700, color: accent, align: "center", valign: up ? "bottom" : "top", shadow: true, minScale: 0.6 }, layer.id, rc, note);
        drawLabel(ctx, event.label, { x: bx, y: up ? y - near - dateH - labelH : y + near + dateH, w: boxW, h: labelH }, { size, weight: 400, color: text, align: "center", valign: up ? "bottom" : "top", maxLines: 3, shadow: true, minScale: 0.55 }, layer.id, rc, note);
      });
    });
    return;
  }

  const x = area.x + area.w * 0.07;
  const y0 = area.y + area.h * 0.06;
  const y1 = area.y + area.h * 0.94;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = withAlpha(muted, 0.35);
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.strokeStyle = primary;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y0 + (y1 - y0) * progress);
  ctx.stroke();
  ctx.restore();
  const slotH = (y1 - y0) / Math.max(1, n - 1);
  const size = Math.max(8, Math.min(rc.height * 0.05, slotH * 0.42));
  layer.events.forEach((event, i) => {
    const y = y0 + (y1 - y0) * along(i);
    if (progress < along(i) - 1e-6) return;
    const appear = phase(timing.local, 0.1 + Math.max(0.6, Math.min(1.8, timing.length * 0.6)) * along(i), 0.35, "easeOutBack");
    withLayerAlpha(ctx, appear, () => {
      ctx.beginPath();
      ctx.arc(x, y, dot * (0.6 + 0.4 * appear), 0, Math.PI * 2);
      ctx.fillStyle = i === n - 1 ? accent : primary;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = resolveColor("background", rc.theme);
      ctx.stroke();
      const tx = x + dot * 2.2;
      const w = area.x + area.w - tx;
      if (event.date) {
        const dateW = Math.min(w * 0.3, size * 6);
        drawLabel(ctx, event.date, { x: tx, y: y - slotH * 0.5, w: dateW, h: slotH }, { size: size * 1.05, weight: 700, color: accent, align: "left", valign: "middle", shadow: true, minScale: 0.6 }, layer.id, rc, note);
        drawLabel(ctx, event.label, { x: tx + dateW + size * 0.5, y: y - slotH * 0.5, w: w - dateW - size * 0.5, h: slotH }, { size, weight: 400, color: text, align: "left", valign: "middle", maxLines: 2, shadow: true, minScale: 0.55 }, layer.id, rc, note);
      } else {
        drawLabel(ctx, event.label, { x: tx, y: y - slotH * 0.5, w, h: slotH }, { size, weight: 400, color: text, align: "left", valign: "middle", maxLines: 2, shadow: true, minScale: 0.55 }, layer.id, rc, note);
      }
    });
  });
}
