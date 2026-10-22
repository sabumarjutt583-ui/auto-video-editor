import { fontPixels, safeMargins } from "../../captions/layout.ts";
import type { CaptionStyle } from "../../../types/editor.ts";
import type { AspectRatio } from "../../../types/settings.ts";
import { FRAME, type Box } from "./geometry.ts";

/** Frame sizes the preview and render use (the shape decides the caption layout). */
export function frameSize(aspect: AspectRatio): { width: number; height: number } {
  return aspect === "9:16" ? { width: 1080, height: 1920 } : aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
}

/** Captions have at most two rows; the zone is a little taller than that, so a longer script or a pop effect still fits. */
const ROWS = 2;
const LINE_HEIGHT = 1.28;
const PAD = 0.35;

/**
 * The part of the frame the captions can use, as a box (null when captions are off). It is the full width between the caption
 * margins and as tall as two rows of the chosen size at the chosen position, so a graphic placed outside it never covers a caption.
 */
export function captionZone(style: Pick<CaptionStyle, "preset" | "position" | "fontSize">, aspect: AspectRatio): Box | null {
  if (style.preset === "none") return null;
  const { width, height } = frameSize(aspect);
  const px = fontPixels(style, aspect, width, height);
  const margins = safeMargins(aspect, style.position, width, height);
  const block = (ROWS * LINE_HEIGHT + PAD) * px;
  const heightShare = Math.min(1, block / height);
  const edge = (style.preset === "documentary" ? Math.round(width * 0.08) : margins.horizontal) / width;
  const y = style.position === "top" ? margins.vertical / height - (PAD / 2) * px / height : style.position === "middle" ? (1 - heightShare) / 2 : 1 - margins.vertical / height - heightShare + (PAD / 2) * px / height;
  const top = Math.min(1 - heightShare, Math.max(0, y));
  return { x: Math.max(0, edge * 0.5), y: top, w: 1 - Math.max(0, edge * 0.5) * 2, h: heightShare };
}

/** The area graphics may use: the frame without the margins (fractions of the width and the height). */
export function safeArea(margins: { x: number; y: number }): Box {
  const x = Math.min(0.2, Math.max(0, margins.x));
  const y = Math.min(0.2, Math.max(0, margins.y));
  return { x, y, w: 1 - 2 * x, h: 1 - 2 * y };
}

export { FRAME };
