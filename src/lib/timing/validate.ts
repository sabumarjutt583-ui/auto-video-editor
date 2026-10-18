import type { TimedWord } from "./types.ts";

/** A timing file longer or shorter than the voice by more than this probably belongs to another voice. */
export const MISMATCH_SECONDS = 2;

export interface DurationCheck {
  ok: boolean;
  lastEnd: number;
  /** Positive when the timing file is longer than the voice. */
  difference: number;
  message: string;
}

function clock(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Compares the last word's end time with the voice length. */
export function checkAgainstVoice(words: readonly TimedWord[], voiceDuration: number): DurationCheck {
  const lastEnd = words.reduce((latest, word) => Math.max(latest, word.end), 0);
  const difference = lastEnd - voiceDuration;
  if (Math.abs(difference) <= MISMATCH_SECONDS) {
    return { ok: true, lastEnd, difference, message: "" };
  }
  const longer = difference > 0;
  return {
    ok: false,
    lastEnd,
    difference,
    message:
      `This timing file ends at ${clock(lastEnd)}, but the locked voice is ${clock(voiceDuration)} long ` +
      `(${clock(Math.abs(difference))} ${longer ? "longer" : "shorter"}). It may belong to a different voice or to the voice before silences were removed.`,
  };
}

/** Puts words in time order and repairs impossible times (negative, end before start). */
export function tidyWords(words: readonly TimedWord[]): TimedWord[] {
  return words
    .map((word) => {
      const start = Math.max(0, word.start);
      return { text: word.text, start, end: Math.max(start, word.end) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
