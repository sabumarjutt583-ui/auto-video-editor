import { letterCount, splitWords } from "../text.ts";
import type { Cue, ParsedTiming, TimedWord } from "./types.ts";
import { TimingParseError } from "./types.ts";

/**
 * Gives every word of every subtitle line a time, inside the line's time, in proportion
 * to the length of the word. Subtitle files only have line times, so these are estimates.
 */
export function cuesToWords(cues: readonly Cue[]): TimedWord[] {
  const words: TimedWord[] = [];
  for (const cue of cues) {
    const tokens = splitWords(cue.text);
    if (tokens.length === 0) continue;
    // Weights: letters in each word (at least 1, so "—" still gets a sliver).
    const weights = tokens.map((token) => Math.max(1, letterCount(token)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const length = Math.max(0, cue.end - cue.start);
    let position = cue.start;
    tokens.forEach((token, index) => {
      const share = (length * (weights[index] ?? 1)) / total;
      const end = index === tokens.length - 1 ? cue.end : position + share;
      words.push({ text: token, start: round(position), end: round(Math.max(position, end)) });
      position = end;
    });
  }
  return words;
}

export function cuesResult(cues: readonly Cue[], format: string): ParsedTiming {
  const words = cuesToWords(cues);
  if (words.length === 0) throw new TimingParseError(`This ${format} file has no subtitle text.`);
  return { words, estimated: true, format };
}

export function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
