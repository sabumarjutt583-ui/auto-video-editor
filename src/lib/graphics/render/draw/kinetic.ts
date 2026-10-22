import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { clamp01, ease } from "../easing.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, withAlpha } from "./common.ts";
import { layoutRuns, type Placed } from "./label.ts";
import { roundedRect } from "./path.ts";

type KineticLayer = Extract<Layer, { type: "kineticText" }>;

/** When word `i` starts (seconds after the layer) and how long the words take to come in. */
export function wordTimes(count: number, length: number): { start: (i: number) => number; each: number } {
  const gap = Math.max(0.1, Math.min(0.42, (length * 0.7) / Math.max(1, count)));
  return { start: (i) => 0.1 + i * gap, each: Math.max(0.2, Math.min(0.4, gap * 1.4)) };
}

/** Words that come in one at a time (pop, slide or highlight). The layout is fixed, so nothing moves while words arrive. */
export function drawKinetic(ctx: Canvas2D, layer: KineticLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const text = resolveColor(layer.color, rc.theme, "text");
  const accent = resolveColor("accent", rc.theme);
  const runs = layer.words.map((word, i) => ({ text: word, weight: 700, color: text, tag: i }));
  const layout = layoutRuns(ctx, runs, area, { size: layer.size * rc.height, align: "center", maxLines: 3, layerId: layer.id, shadow: true }, rc, note);
  const times = wordTimes(layer.words.length, timing.length);
  const pieces: Placed[] = layout.lines.flat();
  // The newest word that has started gets the highlight.
  let newest = -1;
  layer.words.forEach((_, i) => { if (timing.local >= times.start(i)) newest = i; });
  ctx.save();
  ctx.direction = layout.rtl ? "rtl" : "ltr";
  ctx.textBaseline = "middle";
  ctx.textAlign = layout.rtl ? "right" : "left";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = layout.size * 0.12;
  ctx.shadowOffsetY = layout.size * 0.04;
  for (const piece of pieces) {
    const p = clamp01((timing.local - times.start(piece.tag)) / times.each);
    if (p <= 0) continue;
    const e = ease(layer.style === "pop" ? "easeOutBack" : "easeOut", p);
    ctx.save();
    ctx.globalAlpha *= clamp01(p * 2.5);
    const cx = piece.x + (layout.rtl ? -piece.width / 2 : piece.width / 2);
    const cy = piece.y;
    if (layer.style === "pop") {
      ctx.translate(cx, cy);
      ctx.scale(0.55 + 0.45 * e, 0.55 + 0.45 * e);
      ctx.translate(-cx, -cy);
    } else if (layer.style === "slide") {
      ctx.translate(0, (1 - e) * layout.size * 0.6);
    } else if (piece.tag === newest) {
      // Highlight: a coloured block wipes in behind the newest word.
      const padX = layout.size * 0.18;
      const left = layout.rtl ? piece.x - piece.width : piece.x;
      ctx.save();
      roundedRect(ctx, left - padX, cy - layout.lineHeight * 0.46, (piece.width + 2 * padX) * e, layout.lineHeight * 0.92, layout.size * 0.2);
      ctx.fillStyle = withAlpha(accent, 0.92);
      ctx.fill();
      ctx.restore();
    }
    ctx.font = piece.font;
    ctx.fillStyle = layer.style === "highlight" && piece.tag === newest ? resolveColor("background", rc.theme) : piece.color;
    ctx.fillText(piece.text, piece.x, piece.y);
    ctx.restore();
  }
  ctx.restore();
}
