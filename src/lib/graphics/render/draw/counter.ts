import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D } from "../context.ts";
import { formatNumber } from "../format.ts";
import { resolveColor } from "../theme.ts";
import { type DrawEnv, phase } from "./common.ts";
import { drawLabel, textWidth } from "./label.ts";

type CounterLayer = Extract<Layer, { type: "counter" }>;

/** How long the count takes: most of the time the layer is on screen, but never slower than 2.5 s or quicker than 0.4 s. */
export function countDuration(length: number): number {
  return Math.max(0.4, Math.min(2.5, length * 0.6));
}

/** The number a counter shows `local` seconds after it started (exact `to` when the count is over). */
export function counterValue(layer: CounterLayer, local: number, length: number): number {
  const p = phase(local, 0.1, countDuration(length), "easeOut");
  const value = layer.from + (layer.to - layer.from) * p;
  return p >= 1 ? layer.to : value;
}

/** A big number that counts up (or down) with its label under it. */
export function drawCounter(ctx: Canvas2D, layer: CounterLayer, area: Area, env: DrawEnv): void {
  const { rc, note, timing } = env;
  const style = { decimals: layer.decimals, format: layer.format, ...(layer.prefix ? { prefix: layer.prefix } : {}), ...(layer.suffix ? { suffix: layer.suffix } : {}) };
  const text = formatNumber(counterValue(layer, timing.local, timing.length), style);
  const widest = Math.max(textWidth(ctx, formatNumber(layer.to, style), 100, 700, rc), textWidth(ctx, formatNumber(layer.from, style), 100, 700, rc));
  const hasLabel = layer.label !== undefined;
  const numberH = area.h * (hasLabel ? 0.64 : 1);
  // As large as the spec asks, but never wider than the box or taller than its share of it.
  const size = Math.max(8, Math.min(layer.size * rc.height, numberH / 1.25, (area.w / widest) * 100));
  const width = (widest / 100) * size;
  const color = resolveColor(layer.color, rc.theme, "text");
  // The number is placed by its final width, so the digits do not jump sideways while counting.
  const x = area.x + (area.w - width) / 2;
  drawLabel(ctx, text, { x, y: area.y, w: Math.max(width, area.x + area.w - x), h: numberH }, { size, weight: 700, color, align: "left", minScale: 1, shadow: true, valign: hasLabel ? "bottom" : "middle" }, layer.id, rc, note);
  if (hasLabel && layer.label) {
    const labelSize = Math.max(8, Math.min(size * 0.4, area.h * 0.28 / 1.25));
    drawLabel(ctx, layer.label, { x: area.x, y: area.y + numberH, w: area.w, h: area.h - numberH }, { size: labelSize, weight: 400, color: resolveColor("muted", rc.theme), align: "center", maxLines: 2, valign: "top", shadow: true }, layer.id, rc, note);
  }
}
