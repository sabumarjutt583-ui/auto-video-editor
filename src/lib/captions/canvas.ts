import { isNoSpaceChar } from "../text.ts";
import type { AspectRatio } from "../../types/settings.ts";
import type { CaptionLine, CaptionStyle, CaptionWord } from "../../types/editor.ts";
import { fallbackFamilies, type FontInfo } from "./fonts.ts";
import { fontPixels, safeMargins, strokePixels } from "./layout.ts";
import { lineAt } from "./lines.ts";

export interface CaptionPaint {
  style: CaptionStyle;
  font: FontInfo;
  rtl: boolean;
  aspect: AspectRatio;
}

/** Words shown together in the Pop preset (the same as in the ASS file). */
export const POP_GROUP = 2;
const POP_SECONDS = 0.12;

/** Splits a caption into its rows of words. */
export function rowsOf(line: CaptionLine): CaptionWord[][] {
  const at = line.breakAt;
  return at !== null && at > 0 && at < line.words.length ? [line.words.slice(0, at), line.words.slice(at)] : [line.words];
}

/** The words on screen for the Pop preset at a time: the group being spoken. */
export function popGroup(line: CaptionLine, time: number): { words: CaptionWord[]; start: number } {
  let group = 0;
  line.words.forEach((word, i) => {
    if (time >= word.start && Math.floor(i / POP_GROUP) > group) group = Math.floor(i / POP_GROUP);
  });
  const words = line.words.slice(group * POP_GROUP, group * POP_GROUP + POP_GROUP);
  return { words, start: group === 0 ? line.start : (words[0]?.start ?? line.start) };
}

function needsSpace(previous: string, next: string): boolean {
  const last = [...previous].pop() ?? "";
  const first = [...next][0] ?? "";
  return !(isNoSpaceChar(last) && isNoSpaceChar(first));
}

/** Draws the caption that belongs at `time`, in the same look as the ASS file. */
export function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, lines: readonly CaptionLine[], paint: CaptionPaint): void {
  const { style, font, rtl, aspect } = paint;
  if (style.preset === "none") return;
  const line = lineAt(lines, time);
  if (!line) return;
  const px = fontPixels(style, aspect, width, height);
  const margins = safeMargins(aspect, style.position, width, height);
  const pop = style.preset === "pop" ? popGroup(line, time) : null;
  const rows = pop ? [pop.words] : rowsOf(line);
  const upper = (text: string) => (style.uppercase ? text.toUpperCase() : text);

  ctx.save();
  ctx.font = `700 ${px}px ${fallbackFamilies(font)}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.direction = "ltr";
  ctx.lineJoin = "round";
  const space = ctx.measureText(" ").width;
  const lineHeight = px * 1.28;
  const measured = rows.map((row) => {
    const widths = row.map((w) => ctx.measureText(upper(w.text)).width);
    const gaps = row.map((w, i) => (i === 0 ? 0 : needsSpace(row[i - 1]?.text ?? "", w.text) ? space : 0));
    return { row, widths, gaps, total: widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0) };
  });
  const blockHeight = measured.length * lineHeight;
  const top = style.position === "top" ? margins.vertical : style.position === "middle" ? (height - blockHeight) / 2 : height - margins.vertical - blockHeight;
  const left = style.preset === "documentary";
  const edge = style.preset === "documentary" ? Math.round(width * 0.08) : margins.horizontal;

  if (pop) {
    const scale = 0.8 + 0.2 * Math.min(1, Math.max(0, (time - pop.start) / POP_SECONDS));
    ctx.translate(width / 2, top + blockHeight / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -(top + blockHeight / 2));
  }

  const outline = strokePixels(style.outline, height);
  const shadow = strokePixels(style.shadow, height);
  measured.forEach((entry, r) => {
    const base = top + r * lineHeight + px * 1.0;
    const startX = left ? (rtl ? width - edge - entry.total : edge) : (width - entry.total) / 2;
    if (style.preset === "boxed") {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const padX = px * 0.28;
      const padY = px * 0.12;
      ctx.beginPath();
      ctx.roundRect(startX - padX, base - px * 0.98 - padY, entry.total + padX * 2, lineHeight + padY, px * 0.18);
      ctx.fill();
    }
    let x = rtl ? startX + entry.total : startX;
    entry.row.forEach((word, i) => {
      const w = entry.widths[i] ?? 0;
      const gap = entry.gaps[i] ?? 0;
      const drawAt = rtl ? x - gap - w : x + gap;
      const spoken = style.preset === "highlight" && time >= word.start;
      const text = upper(word.text);
      if (style.preset !== "boxed" && outline > 0) {
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = outline * 2;
        if (shadow > 0) {
          ctx.shadowColor = "rgba(0,0,0,0.6)";
          ctx.shadowOffsetX = shadow;
          ctx.shadowOffsetY = shadow;
        }
        ctx.strokeText(text, drawAt, base);
      }
      ctx.shadowColor = style.preset !== "boxed" && outline === 0 && shadow > 0 ? "rgba(0,0,0,0.6)" : "transparent";
      if (ctx.shadowColor !== "transparent") {
        ctx.shadowOffsetX = shadow;
        ctx.shadowOffsetY = shadow;
      }
      ctx.fillStyle = spoken ? style.highlight : style.primary;
      ctx.fillText(text, drawAt, base);
      ctx.shadowColor = "transparent";
      x = rtl ? drawAt : drawAt + w;
    });
  });
  ctx.restore();
}
