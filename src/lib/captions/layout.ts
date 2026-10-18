import type { AspectRatio } from "../../types/settings.ts";
import type { CaptionPosition, CaptionStyle } from "../../types/editor.ts";

export interface Margins {
  /** Pixels from the top or bottom edge (0 for the middle). */
  vertical: number;
  horizontal: number;
}

/** Room kept free at the edges, so captions stay clear of phone buttons and screen corners. */
export function safeMargins(aspect: AspectRatio, position: CaptionPosition, width: number, height: number): Margins {
  const vertical = aspect === "9:16";
  const horizontal = Math.round(width * (vertical ? 0.07 : 0.06));
  if (position === "middle") return { vertical: 0, horizontal };
  const share = position === "bottom" ? (vertical ? 0.18 : 0.08) : vertical ? 0.12 : 0.07;
  return { vertical: Math.round(height * share), horizontal };
}

/** Font size in pixels for a style and frame size. Vertical video gets a bigger size for the same setting. */
export function fontPixels(style: Pick<CaptionStyle, "fontSize">, aspect: AspectRatio, width: number, height: number): number {
  const short = Math.min(width, height);
  return Math.round((style.fontSize / 100) * short * (aspect === "9:16" ? 1.25 : 1));
}

/** Outline or shadow strength (0 to 8) in pixels. */
export function strokePixels(strength: number, height: number): number {
  return (strength * height * 0.9) / 1080;
}
