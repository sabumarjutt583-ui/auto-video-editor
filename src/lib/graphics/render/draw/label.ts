import type { Area, Canvas2D, RenderContext, RenderNote } from "../context.ts";
import { ellipsize, fitText } from "../fit.ts";
import { detectScript, isRtl } from "../script.ts";
import { graphemes, lineWidth, toPieces, type Piece } from "../wrap.ts";

/** A run that starts with one of these is written right after the run before it. */
const GLUE = /^[,.;:!?)\]}%]/;
const NO_SPACES: ReadonlySet<string> = new Set(["japanese", "chinese"]);

export interface Run {
  text: string;
  weight: number;
  color: string;
  /** Carried to every piece made from this run (kinetic text uses it for the word number). */
  tag?: number;
}

export interface TextStyle {
  /** Font size in pixels. */
  size: number;
  align: "left" | "center" | "right";
  maxLines: number;
  /** Share of the characters shown (typewriter), 1 = all. */
  reveal?: number;
  /** Soft shadow under the letters (default on). */
  shadow?: boolean;
  /** Where the block of lines sits inside the area (default middle). */
  valign?: "top" | "middle" | "bottom";
  /** Smallest size, as a share of `size`, before the text is cut (default 0.5). */
  minScale?: number;
  /** Used in notes. */
  layerId: string;
}

export interface TextResult {
  size: number;
  lines: number;
  /** Width of the widest line and height of the block, in pixels. */
  width: number;
  height: number;
  truncated: boolean;
}

interface RunStyle {
  weight: number;
  color: string;
  tag: number;
}

/** One piece of text with its place on the canvas. */
export interface Placed {
  text: string;
  x: number;
  y: number;
  width: number;
  font: string;
  color: string;
  tag: number;
}

export interface Layout extends Omit<TextResult, "lines"> {
  rtl: boolean;
  lineHeight: number;
  /** Pieces by line. */
  lines: Placed[][];
}

/** Wraps runs of text inside an area and says where every piece goes (nothing is drawn). */
export function layoutRuns(ctx: Canvas2D, runs: readonly Run[], area: Area, style: TextStyle, rc: RenderContext, note: (n: RenderNote) => void): Layout {
  const joined = runs.map((r) => r.text).join(" ");
  const script = detectScript(joined);
  const rtl = isRtl(script);
  const family = rc.theme.fonts[script];
  const startSize = style.size;
  const fontOf = (s: RunStyle, size: number): string => `${s.weight} ${size}px ${family}`;
  const measure = (text: string, s: RunStyle, size: number): number => {
    ctx.font = fontOf(s, size);
    return ctx.measureText(text).width;
  };
  const baseStyle: RunStyle = { weight: runs[0]?.weight ?? 400, color: runs[0]?.color ?? "#fff", tag: 0 };

  const fitted = fitText<RunStyle>({
    makePieces: (size) => {
      const pieces: Piece<RunStyle>[] = [];
      runs.forEach((run, index) => {
        const s: RunStyle = { weight: run.weight, color: run.color, tag: run.tag ?? index };
        // The spec trims every text, so runs are separated by one space, except before closing punctuation
        // and in Chinese and Japanese, which are written without spaces.
        const last = pieces[pieces.length - 1];
        if (index > 0 && last && !GLUE.test(run.text) && !NO_SPACES.has(script)) last.space = true;
        pieces.push(...toPieces(run.text, s, (t, st) => measure(t, st, size), area.w));
      });
      return pieces;
    },
    spaceWidth: (size) => measure(" ", baseStyle, size),
    boxW: area.w,
    boxH: area.h,
    size: startSize,
    maxLines: style.maxLines,
    minSize: Math.max(10, startSize * (style.minScale ?? 0.5)),
  });
  if (fitted.shrunk) note({ layerId: style.layerId, kind: "shrunk", message: `The text was made smaller (${Math.round(startSize)} px to ${Math.round(fitted.size)} px) to fit its box.` });

  const space = measure(" ", baseStyle, fitted.size);
  let lines = fitted.lines;
  if (fitted.truncated) {
    note({ layerId: style.layerId, kind: "truncated", message: "The text did not fit and was cut with an ellipsis." });
    const lastIndex = lines.length - 1;
    const last = lines[lastIndex];
    if (last) lines = [...lines.slice(0, lastIndex), ellipsize(last, area.w, (t, s) => measure(t, s, fitted.size), space)];
  }

  const blockH = lines.length * fitted.lineHeight;
  const valign = style.valign ?? "middle";
  const top = valign === "top" ? area.y : valign === "bottom" ? area.y + area.h - blockH : area.y + (area.h - blockH) / 2;
  let widest = 0;
  const placed: Placed[][] = lines.map((line, row) => {
    const width = lineWidth(line, space);
    widest = Math.max(widest, width);
    const y = top + (row + 0.5) * fitted.lineHeight;
    const startX = style.align === "left" ? area.x : style.align === "right" ? area.x + area.w - width : area.x + (area.w - width) / 2;
    let x = rtl ? startX + width : startX;
    return line.map((piece, i): Placed => {
      const out: Placed = { text: piece.text, x, y, width: piece.width, font: fontOf(piece.meta, fitted.size), color: piece.meta.color, tag: piece.meta.tag };
      const advance = piece.width + (i < line.length - 1 && piece.space ? space : 0);
      x += rtl ? -advance : advance;
      return out;
    });
  });
  return { size: fitted.size, lines: placed, lineHeight: fitted.lineHeight, rtl, width: widest, height: blockH, truncated: fitted.truncated };
}

/** Wraps and draws runs of text inside an area. Text and rich text layers and every label of the other layers use this one layout. */
export function drawRuns(ctx: Canvas2D, runs: readonly Run[], area: Area, style: TextStyle, rc: RenderContext, note: (n: RenderNote) => void): TextResult {
  const layout = layoutRuns(ctx, runs, area, style, rc, note);
  ctx.save();
  ctx.direction = layout.rtl ? "rtl" : "ltr";
  ctx.textBaseline = "middle";
  ctx.textAlign = layout.rtl ? "right" : "left";
  if (style.shadow !== false && rc.theme.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${rc.theme.shadow})`;
    ctx.shadowBlur = layout.size * 0.12 * (rc.theme.shadow / 0.45);
    ctx.shadowOffsetY = layout.size * 0.04;
  }
  const total = layout.lines.reduce((n, line) => n + line.reduce((m, p) => m + graphemes(p.text).length, 0), 0);
  let budget = layout.rtl ? total : Math.round(total * (style.reveal ?? 1));
  for (const line of layout.lines) {
    for (const piece of line) {
      if (budget <= 0) break;
      const chars = graphemes(piece.text);
      const text = chars.length <= budget ? piece.text : chars.slice(0, budget).join("");
      budget -= chars.length;
      ctx.font = piece.font;
      ctx.fillStyle = piece.color;
      ctx.fillText(text, piece.x, piece.y);
    }
  }
  ctx.restore();
  return { size: layout.size, lines: layout.lines.length, width: layout.width, height: layout.height, truncated: layout.truncated };
}

/** One text in one style: the usual label. */
export function drawLabel(
  ctx: Canvas2D, text: string, area: Area, style: Omit<TextStyle, "layerId" | "maxLines"> & { maxLines?: number; weight: number; color: string }, layerId: string,
  rc: RenderContext, note: (n: RenderNote) => void,
): TextResult {
  const { weight, color, maxLines, ...rest } = style;
  return drawRuns(ctx, [{ text, weight, color }], area, { ...rest, maxLines: maxLines ?? 1, layerId, shadow: rest.shadow ?? false }, rc, note);
}

/** Width of a text in pixels in the font its script uses (for layout that depends on text size, such as chart labels). */
export function textWidth(ctx: Canvas2D, text: string, size: number, weight: number, rc: RenderContext): number {
  ctx.save();
  ctx.font = `${weight} ${size}px ${rc.theme.fonts[detectScript(text)]}`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}
