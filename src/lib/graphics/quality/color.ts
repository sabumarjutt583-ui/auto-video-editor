import { resolveColor, type Theme } from "../render/theme.ts";

export type RGB = readonly [number, number, number];

/** #RRGGBB or #RRGGBBAA (also #RGB) -> channels 0..255 and alpha 0..1. */
export function parseHex(value: string): { rgb: RGB; alpha: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m) return null;
  let h = m[1] as string;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) / 255 : 1 };
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance (WCAG). */
export const luminance = (c: RGB): number => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);

/** Contrast ratio of two colours, 1 (same) to 21 (black on white). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `front` over `back` with the opacity `alpha`. */
export const mix = (front: RGB, back: RGB, alpha: number): RGB => [0, 1, 2].map((i) => Math.round((front[i] as number) * alpha + (back[i] as number) * (1 - alpha))) as unknown as RGB;

export const toHex = (c: RGB): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** A spec colour (name or hex) as channels; unknown values fall back to the theme's text colour. */
export function rgbOf(value: string | undefined, theme: Theme, fallback: keyof Theme["colors"] = "text"): RGB {
  return parseHex(resolveColor(value, theme, fallback))?.rgb ?? [255, 255, 255];
}

/** White or black, whichever reads better on this background. */
export function readableOn(background: RGB): "#ffffff" | "#000000" {
  return contrastRatio([255, 255, 255], background) >= contrastRatio([0, 0, 0], background) ? "#ffffff" : "#000000";
}

export const MIN_CONTRAST = 4.5;
