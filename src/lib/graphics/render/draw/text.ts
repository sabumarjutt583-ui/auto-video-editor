import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, RenderContext, RenderNote } from "../context.ts";
import { ellipsize, fitText } from "../fit.ts";
import type { Pose } from "../anim.ts";
import { detectScript, isRtl } from "../script.ts";
import { resolveColor, WEIGHTS } from "../theme.ts";
import { graphemes, lineWidth, toPieces, type Piece } from "../wrap.ts";

type TextLayer = Extract<Layer, { type: "text" }>;
type RichLayer = Extract<Layer, { type: "richText" }>;

/** A run that starts with one of these is written right after the run before it. */
const GLUE = /^[,.;:!?)\]}%]/;
const NO_SPACES: ReadonlySet<string> = new Set(["japanese", "chinese"]);

interface RunStyle {
  weight: number;
  color: string;
}

/** Text and rich text share one layout: a text is a rich text with one run. */
export function drawTextLike(ctx: Canvas2D, layer: TextLayer | RichLayer, area: Area, pose: Pose, rc: RenderContext, note: (n: RenderNote) => void): void {
  const runs: { text: string; weight: number; color: string }[] =
    layer.type === "text"
      ? [{ text: layer.text, weight: WEIGHTS[layer.weight], color: resolveColor(layer.color, rc.theme) }]
      : layer.runs.map((run) => ({ text: run.text, weight: WEIGHTS[run.weight ?? "regular"], color: resolveColor(run.color ?? layer.runs[0]?.color, rc.theme) }));
  const joined = runs.map((r) => r.text).join(" ");
  const script = detectScript(joined);
  const rtl = isRtl(script);
  const family = rc.theme.fonts[script];
  const startSize = layer.size * rc.height;
  const fontOf = (style: RunStyle, size: number): string => `${style.weight} ${size}px ${family}`;
  const measure = (text: string, style: RunStyle, size: number): number => {
    ctx.font = fontOf(style, size);
    return ctx.measureText(text).width;
  };
  const baseStyle: RunStyle = { weight: runs[0]?.weight ?? 400, color: runs[0]?.color ?? "#fff" };

  const fitted = fitText<RunStyle>({
    makePieces: (size) => {
      const pieces: Piece<RunStyle>[] = [];
      runs.forEach((run, index) => {
        const style: RunStyle = { weight: run.weight, color: run.color };
        // The spec trims every text, so runs are separated by one space, except before closing punctuation
        // and in Chinese and Japanese, which are written without spaces.
        const last = pieces[pieces.length - 1];
        if (index > 0 && last && !GLUE.test(run.text) && !NO_SPACES.has(script)) last.space = true;
        pieces.push(...toPieces(run.text, style, (t, s) => measure(t, s, size), area.w));
      });
      return pieces;
    },
    spaceWidth: (size) => measure(" ", baseStyle, size),
    boxW: area.w,
    boxH: area.h,
    size: startSize,
    maxLines: layer.maxLines,
    minSize: Math.max(10, startSize * 0.5),
  });
  if (fitted.shrunk) note({ layerId: layer.id, kind: "shrunk", message: `The text was made smaller (${Math.round(startSize)} px to ${Math.round(fitted.size)} px) to fit its box.` });

  const space = measure(" ", baseStyle, fitted.size);
  let lines = fitted.lines;
  if (fitted.truncated) {
    note({ layerId: layer.id, kind: "truncated", message: "The text did not fit and was cut with an ellipsis." });
    const lastIndex = lines.length - 1;
    const last = lines[lastIndex];
    if (last) lines = [...lines.slice(0, lastIndex), ellipsize(last, area.w, (t, s) => measure(t, s, fitted.size), space)];
  }

  const blockH = lines.length * fitted.lineHeight;
  const top = area.y + (area.h - blockH) / 2;
  ctx.save();
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = fitted.size * 0.12;
  ctx.shadowOffsetY = fitted.size * 0.04;

  const total = lines.reduce((n, line) => n + line.reduce((m, p) => m + graphemes(p.text).length, 0), 0);
  let budget = rtl ? total : Math.round(total * pose.reveal);
  lines.forEach((line, row) => {
    const width = lineWidth(line, space);
    const y = top + (row + 0.5) * fitted.lineHeight;
    const startX = layer.align === "left" ? area.x : layer.align === "right" ? area.x + area.w - width : area.x + (area.w - width) / 2;
    let x = rtl ? startX + width : startX;
    ctx.textAlign = rtl ? "right" : "left";
    line.forEach((piece, i) => {
      if (budget <= 0) return;
      const chars = graphemes(piece.text);
      const text = chars.length <= budget ? piece.text : chars.slice(0, budget).join("");
      budget -= chars.length;
      ctx.font = fontOf(piece.meta, fitted.size);
      ctx.fillStyle = piece.meta.color;
      ctx.fillText(text, x, y);
      const advance = piece.width + (i < line.length - 1 && piece.space ? space : 0);
      x += rtl ? -advance : advance;
    });
  });
  ctx.restore();
}
