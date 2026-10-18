import type { AspectRatio, Quality } from "../../types/settings.ts";
import type { CaptionLine, CaptionStyle } from "../../types/editor.ts";
import { outputSize } from "../editor/size.ts";
import type { FontInfo } from "./fonts.ts";
import { fontPixels, safeMargins, strokePixels } from "./layout.ts";

/** What the Rust ASS generator needs (see src-tauri/src/captions/model.rs). Sizes are in output pixels. */
export interface AssRequest {
  width: number;
  height: number;
  look: {
    preset: CaptionStyle["preset"];
    font: string;
    fontSize: number;
    primary: string;
    highlight: string;
    outline: number;
    shadow: number;
    position: CaptionStyle["position"];
    uppercase: boolean;
    bold: boolean;
    marginV: number;
    marginH: number;
  };
  lines: { start: number; end: number; words: CaptionLine["words"]; breakAt: number | null }[];
}

export function buildAssRequest(aspect: AspectRatio, quality: Quality, style: CaptionStyle, font: FontInfo, lines: readonly CaptionLine[]): AssRequest {
  const { width, height } = outputSize(aspect, quality);
  const margins = safeMargins(aspect, style.position, width, height);
  return {
    width,
    height,
    look: {
      preset: style.preset,
      font: font.family,
      fontSize: fontPixels(style, aspect, width, height),
      primary: style.primary,
      highlight: style.highlight,
      outline: Math.round(strokePixels(style.outline, height) * 10) / 10,
      shadow: Math.round(strokePixels(style.shadow, height) * 10) / 10,
      position: style.position,
      uppercase: style.uppercase,
      bold: true,
      marginV: margins.vertical,
      marginH: style.preset === "documentary" ? Math.round(width * 0.08) : margins.horizontal,
    },
    lines: lines.map((line) => ({ start: line.start, end: line.end, words: line.words, breakAt: line.breakAt })),
  };
}
