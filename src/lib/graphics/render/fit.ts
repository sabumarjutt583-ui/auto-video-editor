import { breakLines, lineWidth, graphemes, toPieces, type Measure, type Piece } from "./wrap.ts";

export interface FitInput<M> {
  /** Pieces are made again for every font size, so the `measure` function gets the size. */
  makePieces: (size: number) => Piece<M>[];
  spaceWidth: (size: number) => number;
  boxW: number;
  boxH: number;
  /** The size the spec asks for, in pixels. */
  size: number;
  maxLines: number;
  /** Smallest size that is still used before the text is cut with an ellipsis. */
  minSize: number;
  lineHeight?: number;
}

export interface Fitted<M> {
  size: number;
  lines: Piece<M>[][];
  lineHeight: number;
  /** The text did not fit even at the smallest size and was cut. */
  truncated: boolean;
  /** The font size had to be made smaller. */
  shrunk: boolean;
}

const LINE_HEIGHT = 1.25;
const STEP = 0.93;

/** Wraps a text inside a box, making the font smaller (down to `minSize`) before it overflows. */
export function fitText<M>(input: FitInput<M>): Fitted<M> {
  const factor = input.lineHeight ?? LINE_HEIGHT;
  let size = input.size;
  const fits = (lines: Piece<M>[][], s: number, space: number): boolean =>
    lines.length <= input.maxLines && lines.length * s * factor <= input.boxH + 1e-6 && lines.every((l) => lineWidth(l, space) <= input.boxW + 1e-6);
  for (;;) {
    const space = input.spaceWidth(size);
    const lines = breakLines(input.makePieces(size), input.boxW, space);
    if (fits(lines, size, space)) return { size, lines, lineHeight: size * factor, truncated: false, shrunk: size < input.size - 1e-9 };
    const next = size * STEP;
    if (next < input.minSize) {
      size = Math.min(input.size, input.minSize);
      const spaceMin = input.spaceWidth(size);
      const all = breakLines(input.makePieces(size), input.boxW, spaceMin);
      const maxByHeight = Math.max(1, Math.floor(input.boxH / (size * factor) + 1e-6));
      const allowed = Math.min(input.maxLines, maxByHeight);
      const kept = all.slice(0, allowed);
      const truncated = all.length > allowed || !all.every((l) => lineWidth(l, spaceMin) <= input.boxW + 1e-6);
      return { size, lines: kept, lineHeight: size * factor, truncated, shrunk: size < input.size - 1e-9 };
    }
    size = next;
  }
}

/** Puts an ellipsis at the end of a line, removing characters (and whole words if needed) until the line fits. */
export function ellipsize<M>(line: Piece<M>[], maxWidth: number, measure: Measure<M>, spaceWidth: number): Piece<M>[] {
  for (let k = line.length; k >= 1; k--) {
    const head = line.slice(0, k - 1);
    const last = line[k - 1];
    if (!last) continue;
    const used = lineWidth(head, spaceWidth) + (head.length > 0 && head[head.length - 1]?.space ? spaceWidth : 0);
    const chars = graphemes(last.text);
    for (let n = chars.length; n >= (k === 1 ? 0 : 1); n--) {
      const text = chars.slice(0, n).join("") + "…";
      const width = measure(text, last.meta);
      if (used + width <= maxWidth + 1e-6) return [...head, { text, width, space: false, meta: last.meta }];
    }
  }
  const first = line[0];
  return first ? [{ text: "…", width: measure("…", first.meta), space: false, meta: first.meta }] : line;
}

export { toPieces };
