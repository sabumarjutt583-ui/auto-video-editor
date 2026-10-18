import { joinWords, splitWords } from "../text.ts";
import type { CaptionLine, CaptionWord } from "../../types/editor.ts";
import { chooseBreak } from "./lines.ts";

/** The text of a caption: its words joined, with a line break where the second line starts. */
export function textOfWords(words: readonly CaptionWord[], breakAt: number | null): string {
  const join = (list: readonly CaptionWord[]) => joinWords(list.map((w) => w.text));
  return breakAt === null ? join(words) : `${join(words.slice(0, breakAt))}\n${join(words.slice(breakAt))}`;
}

/**
 * New text for a caption. The timing stays: when the number of words is the same each word keeps its
 * time, otherwise the new words share the caption's time by their length. A line break the user typed
 * is kept; without one, the break is chosen again.
 */
export function withText(line: CaptionLine, text: string, maxChars: number): CaptionLine {
  const parts = text.split(/\r?\n/).map((part) => splitWords(part)).filter((part) => part.length > 0);
  const tokens = parts.flat();
  if (tokens.length === 0) return line;
  let words: CaptionWord[];
  if (tokens.length === line.words.length) {
    words = line.words.map((w, i) => ({ ...w, text: tokens[i] ?? w.text }));
  } else {
    const first = line.words[0]?.start ?? line.start;
    const last = line.words[line.words.length - 1]?.end ?? line.end;
    const total = tokens.reduce((sum, t) => sum + Math.max(1, [...t].length), 0);
    let at = first;
    words = tokens.map((token) => {
      const share = ((last - first) * Math.max(1, [...token].length)) / total;
      const word = { text: token, start: at, end: at + share };
      at += share;
      return word;
    });
  }
  const breakAt = parts.length > 1 ? (parts[0]?.length ?? null) : chooseBreak(words, maxChars);
  return { ...line, words, breakAt, text: textOfWords(words, breakAt) };
}

/** Changes when a caption starts and ends. Times stay inside the neighbours and keep at least 0.2 s. */
export function withTimes(lines: readonly CaptionLine[], index: number, start: number, end: number, voiceDuration: number): CaptionLine[] {
  const line = lines[index];
  if (!line) return [...lines];
  const minStart = lines[index - 1]?.end ?? 0;
  const maxEnd = lines[index + 1]?.start ?? voiceDuration;
  const s = Math.min(Math.max(start, minStart), Math.max(minStart, maxEnd - 0.2));
  const e = Math.min(Math.max(end, s + 0.2), maxEnd);
  return lines.map((l, i) => (i === index ? { ...l, start: s, end: e } : l));
}

/** Removes a caption. */
export function removeLine(lines: readonly CaptionLine[], index: number): CaptionLine[] {
  return lines.filter((_, i) => i !== index);
}
