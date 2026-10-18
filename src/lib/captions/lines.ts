import { joinWords } from "../text.ts";
import type { CaptionLine, CaptionWord } from "../../types/editor.ts";
import type { TimedWord } from "../timing/types.ts";

export const PAUSE_BREAK = 0.35;
export const MIN_DURATION = 0.8;
const SENTENCE_END = /[.!?…。！？．｡।॥۔؟‼⁇⁈⁉‽]["'”’»」』）)\]】〉》]*$/u;
const CLAUSE_END = /[,;:、，；：،؛]["'”’»」』）)\]】〉》]*$/u;

export interface BuildOptions {
  /** Characters that fit on one line. */
  maxChars: number;
  pause?: number;
  minDuration?: number;
}

function textOf(words: readonly CaptionWord[]): string {
  return joinWords(words.map((w) => w.text));
}

function lengthOf(words: readonly CaptionWord[]): number {
  return [...textOf(words)].length;
}

/** Where a two-line caption breaks: the word that starts the second line, or null when one line is enough. */
export function chooseBreak(words: readonly CaptionWord[], maxChars: number): number | null {
  if (words.length < 2 || lengthOf(words) <= maxChars) return null;
  let best: { at: number; cost: number } | null = null;
  for (let at = 1; at < words.length; at += 1) {
    const first = lengthOf(words.slice(0, at));
    const second = lengthOf(words.slice(at));
    const overflow = Math.max(0, first - maxChars) + Math.max(0, second - maxChars);
    const previous = words[at - 1]?.text ?? "";
    // Balanced lines are best; a break after punctuation is a little better.
    const bonus = SENTENCE_END.test(previous) || CLAUSE_END.test(previous) ? 3 : 0;
    const cost = overflow * 10 + Math.abs(first - second) - bonus;
    if (!best || cost < best.cost) best = { at, cost };
  }
  return best?.at ?? null;
}

function makeLine(index: number, words: CaptionWord[], maxChars: number): CaptionLine {
  const breakAt = chooseBreak(words, maxChars);
  const first = words[0];
  const last = words[words.length - 1];
  const text = breakAt === null ? textOf(words) : `${textOf(words.slice(0, breakAt))}\n${textOf(words.slice(breakAt))}`;
  return { id: `C${String(index).padStart(3, "0")}`, start: first?.start ?? 0, end: last?.end ?? 0, text, words, breakAt };
}

/** True when the words fit on one row, or can be split into two rows that both fit. */
function fits(words: readonly CaptionWord[], maxChars: number): boolean {
  if (lengthOf(words) <= maxChars) return true;
  const at = chooseBreak(words, maxChars);
  return at !== null && lengthOf(words.slice(0, at)) <= maxChars && lengthOf(words.slice(at)) <= maxChars;
}

/**
 * Groups words into captions of at most two lines. A caption ends at a sentence mark, and at a clause
 * mark or a pause longer than `pause` once it is half full; it also ends when the next word would not fit.
 */
export function groupWords(words: readonly TimedWord[], options: BuildOptions): CaptionWord[][] {
  const pause = options.pause ?? PAUSE_BREAK;
    const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  words.forEach((word, i) => {
    const entry: CaptionWord = { text: word.text, start: word.start, end: word.end };
    if (current.length > 0 && !fits([...current, entry], options.maxChars)) {
      // Too long: go back to the last natural break in the second half, if there is one.
      let cut = -1;
      for (let k = current.length - 1; k >= 1; k -= 1) {
        const w = current[k - 1];
        const next = current[k];
        if (w && next && (SENTENCE_END.test(w.text) || CLAUSE_END.test(w.text) || next.start - w.end > pause) && lengthOf(current.slice(0, k)) >= options.maxChars * 0.8 && fits(current.slice(k), options.maxChars)) {
          cut = k;
          break;
        }
      }
      if (cut > 0) {
        const rest = current.slice(cut);
        current = current.slice(0, cut);
        flush();
        current = rest;
      } else flush();
    }
    current.push(entry);
    const next = words[i + 1];
    const half = lengthOf(current) >= options.maxChars * 0.5;
    if (SENTENCE_END.test(word.text) || (half && CLAUSE_END.test(word.text)) || (half && next !== undefined && next.start - word.end > pause)) flush();
  });
  flush();
  return groups;
}

/** Makes every caption last at least `minDuration`: it stays up into the quiet before the next one, or joins the next one. */
export function enforceMinimum(lines: CaptionLine[], voiceDuration: number, options: BuildOptions): CaptionLine[] {
  const minDuration = options.minDuration ?? MIN_DURATION;
  const result: CaptionLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i] as CaptionLine;
    const next = lines[i + 1];
    if (line.end - line.start < minDuration && next) {
      const room = next.start - line.start;
      if (room < minDuration && fits([...line.words, ...next.words], options.maxChars)) {
        // No quiet to stretch into: join the next caption.
        const words = [...line.words, ...next.words];
        lines[i + 1] = { ...makeLine(0, words, options.maxChars), id: line.id };
        continue;
      }
    }
    const limit = next ? next.start : Math.max(line.end, voiceDuration);
    const end = Math.min(limit, Math.max(line.end, line.start + minDuration));
    line = { ...line, end };
    result.push(line);
  }
  return result.map((line, i) => ({ ...line, id: `C${String(i + 1).padStart(3, "0")}` }));
}

/** The caption lines for a list of timed words. */
export function buildLines(words: readonly TimedWord[], voiceDuration: number, options: BuildOptions): CaptionLine[] {
  const groups = groupWords(words, options);
  const lines = groups.map((group, i) => makeLine(i + 1, group, options.maxChars));
  return enforceMinimum(lines, voiceDuration, options);
}

/** The line shown at a time, or null between captions. */
export function lineAt(lines: readonly CaptionLine[], time: number): CaptionLine | null {
  for (const line of lines) if (time >= line.start && time < line.end) return line;
  return null;
}
