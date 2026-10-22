import { breaksEverywhere } from "./script.ts";

/** A piece of text that is never split (a word, or one CJK character) and its measured width. */
export interface Piece<M = undefined> {
  text: string;
  width: number;
  /** A space follows this piece (it is dropped at the end of a line). */
  space: boolean;
  meta: M;
}

/** Measures a text. The renderer passes the canvas; tests pass a fake. */
export type Measure<M = undefined> = (text: string, meta: M) => number;

const CLOSING = new Set([..."。、，．！？）」』】〕》〉,.!?)]}%:;"]);
const OPENING = new Set([..."（「『【〔《〈([{"]);

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : [...text];
}

/**
 * Splits a text into pieces: words in spaced writing systems, single characters in Chinese and Japanese.
 * Closing punctuation stays with the piece before it and opening brackets with the piece after it, so a line never starts with "。".
 * A piece wider than `maxWidth` is cut into characters.
 */
export function toPieces<M>(text: string, meta: M, measure: Measure<M>, maxWidth: number): Piece<M>[] {
  const raw: { text: string; space: boolean }[] = [];
  let word = "";
  const flush = (space: boolean): void => {
    if (word !== "") raw.push({ text: word, space });
    else if (space && raw.length > 0) {
      const last = raw[raw.length - 1];
      if (last) last.space = true;
    }
    word = "";
  };
  for (const ch of graphemes(text.replace(/\s+/g, " "))) {
    if (ch === " ") {
      flush(true);
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (breaksEverywhere(code)) {
      if (CLOSING.has(ch) && word === "" && raw.length > 0) {
        const last = raw[raw.length - 1];
        if (last && !last.space) {
          last.text += ch;
          continue;
        }
      }
      if (OPENING.has(ch)) {
        flush(false);
        word = ch;
        continue;
      }
      if (word !== "" && OPENING.has([...word].pop() ?? "") && [...word].every((c) => OPENING.has(c))) {
        raw.push({ text: word + ch, space: false });
        word = "";
        continue;
      }
      flush(false);
      raw.push({ text: ch, space: false });
    } else {
      word += ch;
    }
  }
  flush(false);

  const out: Piece<M>[] = [];
  for (const item of raw) {
    const width = measure(item.text, meta);
    if (width <= maxWidth || [...item.text].length <= 1) {
      out.push({ text: item.text, width, space: item.space, meta });
      continue;
    }
    // Too wide for one line: cut into characters (a very long word, or a long URL).
    const chars = graphemes(item.text);
    chars.forEach((c, i) => out.push({ text: c, width: measure(c, meta), space: i === chars.length - 1 && item.space, meta }));
  }
  return out;
}

/** Greedy line breaking. Lines hold whole pieces; the trailing space of a line is dropped. */
export function breakLines<M>(pieces: Piece<M>[], maxWidth: number, spaceWidth: number): Piece<M>[][] {
  const lines: Piece<M>[][] = [];
  let line: Piece<M>[] = [];
  let used = 0;
  for (const piece of pieces) {
    const gap = line.length > 0 && line[line.length - 1]?.space === true ? spaceWidth : 0;
    if (line.length > 0 && used + gap + piece.width > maxWidth + 1e-6) {
      lines.push(line);
      line = [];
      used = 0;
    }
    const lead = line.length > 0 && line[line.length - 1]?.space === true ? spaceWidth : 0;
    line.push(piece);
    used += lead + piece.width;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Width of a line of pieces, with the spaces between them. */
export function lineWidth<M>(line: Piece<M>[], spaceWidth: number): number {
  let width = 0;
  line.forEach((piece, i) => {
    width += piece.width;
    if (i < line.length - 1 && piece.space) width += spaceWidth;
  });
  return width;
}

/** The text of a line, with single spaces where the original had spaces. */
export function lineText<M>(line: Piece<M>[]): string {
  return line.map((p, i) => (i < line.length - 1 && p.space ? `${p.text} ` : p.text)).join("");
}
