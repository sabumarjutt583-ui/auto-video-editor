import type { Pose } from "../anim.ts";
import type { Area, Canvas2D, RenderContext, RenderNote } from "../context.ts";
import { clamp01, ease, type EasingName } from "../easing.ts";
import type { LayerTiming } from "../timing.ts";
import { roundedRect } from "./path.ts";

/** What every layer of phase 5 gets besides its own settings. */
export interface DrawEnv {
  rc: RenderContext;
  note: (n: RenderNote) => void;
  timing: LayerTiming;
  pose: Pose;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0..1 progress of something that starts `start` seconds after the layer and lasts `duration` seconds, eased. */
export function phase(local: number, start: number, duration: number, easing: EasingName = "easeOut"): number {
  return ease(easing, clamp01(duration <= 0 ? (local >= start ? 1 : 0) : (local - start) / duration));
}

/** `#RRGGBB` or `#RRGGBBAA` with an extra alpha (0..1) as a CSS colour. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color);
  if (!m) return color;
  const hex = m[1] as string;
  const base = m[2] ? parseInt(m[2], 16) / 255 : 1;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${+(base * clamp01(alpha)).toFixed(4)})`;
}

/** A rounded card behind a layer's content. */
export function drawPanel(ctx: Canvas2D, area: Area, radius: number, fill: string, alpha = 0.92): void {
  ctx.save();
  roundedRect(ctx, area.x, area.y, area.w, area.h, radius);
  ctx.fillStyle = withAlpha(fill, alpha);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.stroke();
  ctx.restore();
}

/** A corner radius of the built-in design, scaled by the brand kit. */
export const cornerRadius = (base: number, rc: RenderContext): number => base * rc.theme.radius;

/** A line thickness of the built-in design, scaled by the brand kit. */
export const lineThickness = (base: number, rc: RenderContext): number => base * rc.theme.strokeWidth;

/** A title as the brand kit writes it (capital letters or as given). */
export const headingText = (text: string, rc: RenderContext): string => (rc.theme.headingCase === "upper" ? text.toUpperCase() : text);

/** Runs `paint` with the current alpha multiplied by `alpha` (skipped when invisible). */
export function withLayerAlpha(ctx: Canvas2D, alpha: number, paint: () => void): void {
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.globalAlpha *= clamp01(alpha);
  paint();
  ctx.restore();
}

/** FNV-1a hash of a text: the seed of a layer's random numbers. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small seeded random number generator (mulberry32): the same seed always gives the same numbers, on every computer. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `v` wrapped into 0..m. */
export const wrap = (v: number, m: number): number => ((v % m) + m) % m;
