import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { isRtlText } from "../script.ts";
import { resolveColor } from "../theme.ts";
import { CHECK_ICON } from "./cards.ts";
import { type DrawEnv, phase, withLayerAlpha } from "./common.ts";
import { drawIconShape } from "./icon.ts";
import { drawLabel } from "./label.ts";

type ListLayer = Extract<Layer, { type: "list" }>;

/** Items that come in one after the other: bullets, numbers or check marks (an item can have its own icon). */
export function drawList(ctx: Canvas2D, layer: ListLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const n = layer.items.length;
  const rowH = Math.min(area.h / n, rc.height * 0.13);
  const top = area.y + (area.h - rowH * n) / 2;
  const accent = resolveColor("accent", rc.theme);
  const textColor = resolveColor("text", rc.theme);
  const marker = Math.min(rowH * 0.62, rc.height * 0.07);
  // Right-to-left texts (Urdu, Arabic) put the markers on the right.
  const rtl = isRtlText(...layer.items.map((item) => item.text));
  const dir = rtl ? -1 : 1;
  // Items arrive 0.2 s apart (closer when there are many, so the last one is in by two thirds of the time).
  const gap = Math.min(0.2, (timing.length * 0.66) / n);
  layer.items.forEach((item, i) => {
    const p = phase(timing.local, 0.1 + i * gap, 0.4, "easeOut");
    withLayerAlpha(ctx, p, () => {
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      ctx.translate((1 - p) * -area.w * 0.04 * dir, 0);
      const mx = rtl ? area.x + area.w - marker / 2 : area.x + marker / 2;
      const shape = item.icon ? rc.icon(item.icon.set, item.icon.name) : undefined;
      if (item.icon && !shape) note({ layerId: layer.id, kind: "missing-icon", message: `Icon ${item.icon.set}:${item.icon.name} is not available.` });
      if (shape) {
        drawIconShape(ctx, shape, { x: mx - marker / 2, y: cy - marker / 2, w: marker, h: marker }, accent);
      } else if (layer.style === "bullets") {
        ctx.beginPath();
        ctx.arc(mx, cy, marker * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(mx, cy, marker / 2, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        if (layer.style === "checks") {
          drawIconShape(ctx, CHECK_ICON, { x: mx - marker * 0.3, y: cy - marker * 0.3, w: marker * 0.6, h: marker * 0.6 }, resolveColor("background", rc.theme));
        } else {
          drawLabel(ctx, String(i + 1), { x: mx - marker / 2, y: cy - marker / 2, w: marker, h: marker }, { size: marker * 0.62, weight: 700, color: resolveColor("background", rc.theme), align: "center", valign: "middle", shadow: false, minScale: 0.6 }, layer.id, rc, note);
        }
      }
      const tx = rtl ? area.x : area.x + marker * 1.45;
      const tw = area.w - marker * 1.45;
      drawLabel(ctx, item.text, { x: tx, y, w: tw, h: rowH }, { size: Math.min(rowH * 0.56, rc.height * 0.06), weight: 700, color: textColor, align: rtl ? "right" : "left", valign: "middle", shadow: true }, layer.id, rc, note);
    });
  });
}
