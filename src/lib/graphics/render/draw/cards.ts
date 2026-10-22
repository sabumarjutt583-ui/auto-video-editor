import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, IconShape } from "../context.ts";
import { isRtlText } from "../script.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, drawPanel, phase, withAlpha, withLayerAlpha } from "./common.ts";
import { drawIconShape } from "./icon.ts";
import { drawLabel } from "./label.ts";
import { roundedRect } from "./path.ts";

type LowerThirdLayer = Extract<Layer, { type: "lowerThird" }>;
type QuoteLayer = Extract<Layer, { type: "quoteCard" }>;

/** The check mark used by list and checklist markers (Lucide "check", copied so no icon set has to be loaded for it). */
export const CHECK_ICON: IconShape = { paths: ["M20 6 9 17l-5-5"], viewBox: 24, filled: false, strokeWidth: 3 };

/** Name bar: an accent stripe that grows, an optional icon in a disc, a title and a subtitle. Right-to-left texts mirror it. */
export function drawLowerThird(ctx: Canvas2D, layer: LowerThirdLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const local = timing.local;
  const rtl = isRtlText(layer.title, layer.subtitle ?? "");
  const radius = Math.min(area.h * 0.22, 18);
  const accent = resolveColor("accent", rc.theme);
  const stripe = phase(local, 0, 0.35, "easeOut");
  drawPanel(ctx, area, radius, resolveColor("secondary", rc.theme), 0.94);
  ctx.save();
  roundedRect(ctx, area.x, area.y, area.w, area.h, radius);
  ctx.clip();
  ctx.fillStyle = accent;
  const stripeW = area.h * 0.09 * stripe + 0.0001;
  ctx.fillRect(rtl ? area.x + area.w - stripeW : area.x, area.y, stripeW, area.h * stripe);
  ctx.restore();

  const pad = area.h * 0.2;
  // `edge` is where the content starts (left, or right for right-to-left); `span` is the room left for the text.
  let inner = area.h * 0.09 + pad;
  const iconPhase = phase(local, 0.1, 0.35, "easeOutBack");
  if (layer.icon) {
    const d = area.h * 0.6;
    const cx = rtl ? area.x + area.w - inner - d / 2 : area.x + inner + d / 2;
    const cy = area.y + area.h / 2;
    const shape = rc.icon(layer.icon.set, layer.icon.name);
    withLayerAlpha(ctx, phase(local, 0.1, 0.3), () => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(0.6 + 0.4 * iconPhase, 0.6 + 0.4 * iconPhase);
      ctx.translate(-cx, -cy);
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = resolveColor("primary", rc.theme);
      ctx.fill();
      if (shape) drawIconShape(ctx, shape, { x: cx - d * 0.3, y: cy - d * 0.3, w: d * 0.6, h: d * 0.6 }, resolveColor("text", rc.theme));
      else note({ layerId: layer.id, kind: "missing-icon", message: `Icon ${layer.icon?.set}:${layer.icon?.name} is not available.` });
      ctx.restore();
    });
    inner += d + pad;
  }
  const textArea = rtl ? { x: area.x + pad, y: area.y, w: area.w - pad - inner, h: area.h } : { x: area.x + inner, y: area.y, w: area.w - pad - inner, h: area.h };
  const align = rtl ? "right" : "left";
  const reveal = phase(local, 0.15, 0.4, "easeOut");
  withLayerAlpha(ctx, reveal, () => {
    ctx.translate((1 - reveal) * -area.h * 0.25 * (rtl ? -1 : 1), 0);
    if (layer.subtitle) {
      const titleSize = Math.min(area.h * 0.36, rc.height * 0.06);
      drawLabel(ctx, layer.title, { x: textArea.x, y: area.y + area.h * 0.1, w: textArea.w, h: area.h * 0.45 }, { size: titleSize, weight: 700, color: resolveColor("text", rc.theme), align, valign: "bottom", shadow: false }, layer.id, rc, note);
      drawLabel(ctx, layer.subtitle, { x: textArea.x, y: area.y + area.h * 0.58, w: textArea.w, h: area.h * 0.34 }, { size: titleSize * 0.62, weight: 400, color: resolveColor("muted", rc.theme), align, valign: "top", shadow: false }, layer.id, rc, note);
    } else {
      drawLabel(ctx, layer.title, { x: textArea.x, y: area.y, w: textArea.w, h: area.h }, { size: Math.min(area.h * 0.42, rc.height * 0.07), weight: 700, color: resolveColor("text", rc.theme), align, valign: "middle", shadow: false, maxLines: 2 }, layer.id, rc, note);
    }
  });
}

/** A quote with a large opening mark and the author under it. */
export function drawQuoteCard(ctx: Canvas2D, layer: QuoteLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const local = timing.local;
  const rtl = isRtlText(layer.quote, layer.author ?? "");
  const align = rtl ? "right" : "left";
  const accent = resolveColor("accent", rc.theme);
  const radius = Math.min(area.h * 0.1, 22);
  drawPanel(ctx, area, radius, resolveColor("secondary", rc.theme), 0.94);
  const pad = Math.min(area.w, area.h) * 0.08;
  const markSize = Math.min(area.h * 0.34, rc.height * 0.16);
  const markIn = phase(local, 0, 0.4, "easeOutBack");
  withLayerAlpha(ctx, phase(local, 0, 0.3), () => {
    ctx.save();
    ctx.translate(0, (1 - markIn) * -area.h * 0.05);
    drawLabel(ctx, "“", { x: rtl ? area.x + area.w - pad - markSize * 1.2 : area.x + pad, y: area.y + pad * 0.4, w: markSize * 1.2, h: markSize * 1.1 }, { size: markSize, weight: 700, color: accent, align, valign: "top", shadow: false, minScale: 1 }, layer.id, rc, note);
    ctx.restore();
  });
  const authorH = layer.author ? area.h * 0.17 : 0;
  const textTop = area.y + area.h * 0.22;
  const textArea = { x: area.x + pad, y: textTop, w: area.w - 2 * pad, h: area.y + area.h - pad - authorH - textTop };
  const quoteSize = Math.min(rc.height * 0.065, textArea.h / 3 / 1.25 * 1.6);
  withLayerAlpha(ctx, phase(local, 0.2, 0.5), () => {
    drawLabel(ctx, layer.quote, textArea, { size: quoteSize, weight: 400, color: resolveColor("text", rc.theme), align, valign: "middle", shadow: false, maxLines: 5 }, layer.id, rc, note);
  });
  if (layer.author) {
    withLayerAlpha(ctx, phase(local, 0.55, 0.4), () => {
      ctx.fillStyle = withAlpha(accent, 1);
      ctx.fillRect(rtl ? area.x + area.w - pad - authorH * 0.5 : area.x + pad, area.y + area.h - pad - authorH * 0.5 - 1, authorH * 0.5, 2);
      drawLabel(ctx, layer.author ?? "", { x: rtl ? area.x + pad : area.x + pad + authorH * 0.75, y: area.y + area.h - pad - authorH, w: area.w - 2 * pad - authorH * 0.75, h: authorH }, { size: Math.min(authorH / 1.25, rc.height * 0.04), weight: 700, color: resolveColor("muted", rc.theme), align, valign: "middle", shadow: false }, layer.id, rc, note);
    });
  }
}
