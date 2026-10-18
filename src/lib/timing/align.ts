import { letterCount, normalizeKey, splitWords } from "../text.ts";
import { round } from "./cues.ts";
import type { TimedWord } from "./types.ts";

export interface AlignmentResult {
  /** The script's words (exact wording) with times. */
  words: TimedWord[];
  /** For each script word: true when it was found in the speech (exactly or nearly). */
  matched: boolean[];
  /** Percent of script words found in the speech, 0 to 100. */
  quality: number;
}

export interface AlignOptions {
  /** Voice length; limits where words after the last matched word can end. */
  voiceDuration?: number;
}

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;
/** Full table below this many cells, a band around the diagonal above it. */
const FULL_TABLE_CELLS = 4_000_000;

/** Splits a word into several when it holds more than one (no-space scripts), sharing its time. */
export function explodeWords(words: readonly TimedWord[]): TimedWord[] {
  const result: TimedWord[] = [];
  for (const word of words) {
    const tokens = splitWords(word.text);
    if (tokens.length <= 1) {
      result.push(word);
      continue;
    }
    const weights = tokens.map((token) => Math.max(1, letterCount(token)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let position = word.start;
    tokens.forEach((token, index) => {
      const end = index === tokens.length - 1 ? word.end : position + ((word.end - word.start) * (weights[index] ?? 1)) / total;
      result.push({ text: token, start: round(position), end: round(end) });
      position = end;
    });
  }
  return result;
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** True when two words are the same, or close enough to be a spelling difference. */
export function similarKeys(a: string, b: string): boolean {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  if (longest < 4 || /^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  return editDistance(a, b) <= Math.floor(longest * 0.34);
}

/** For each script word, the index of the speech word it lines up with (or -1). Needleman-Wunsch. */
export function alignKeys(script: readonly string[], speech: readonly string[]): number[] {
  const n = script.length;
  const m = speech.length;
  const pairs = new Array<number>(n).fill(-1);
  if (n === 0 || m === 0) return pairs;

  const bandHalf = n * m <= FULL_TABLE_CELLS ? Math.max(n, m) : Math.max(150, Math.ceil(0.15 * Math.max(n, m)));
  const centre = (i: number) => Math.round((i * m) / n);
  const low = (i: number) => Math.max(0, centre(i) - bandHalf);
  const high = (i: number) => Math.min(m, centre(i) + bandHalf);
  const width = Math.min(m, 2 * bandHalf) + 1;
  // Direction taken to reach each cell: 1 = both words used, 2 = script word skipped, 3 = speech word skipped.
  const direction = new Uint8Array((n + 1) * width);
  const NEG = -1_000_000_000;

  let previous = new Int32Array(width).fill(NEG);
  let current = new Int32Array(width).fill(NEG);
  for (let j = low(0); j <= high(0); j += 1) {
    previous[j - low(0)] = j * GAP;
    direction[j - low(0)] = 3;
  }

  for (let i = 1; i <= n; i += 1) {
    const lo = low(i);
    const hi = high(i);
    const previousLo = low(i - 1);
    const previousHi = high(i - 1);
    current.fill(NEG);
    const key = script[i - 1] ?? "";
    for (let j = lo; j <= hi; j += 1) {
      let best = NEG;
      let way = 0;
      if (j > 0 && j - 1 >= previousLo && j - 1 <= previousHi) {
        const diagonal = previous[j - 1 - previousLo] ?? NEG;
        if (diagonal > NEG) {
          best = diagonal + (key === speech[j - 1] ? MATCH : MISMATCH);
          way = 1;
        }
      }
      if (j >= previousLo && j <= previousHi) {
        const above = previous[j - previousLo] ?? NEG;
        if (above > NEG && above + GAP > best) {
          best = above + GAP;
          way = 2;
        }
      }
      if (j > lo) {
        const left = current[j - 1 - lo] ?? NEG;
        if (left > NEG && left + GAP > best) {
          best = left + GAP;
          way = 3;
        }
      }
      current[j - lo] = best;
      direction[i * width + (j - lo)] = way;
    }
    [previous, current] = [current, previous];
  }

  // Walk back from the bottom-right corner.
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i === 0) {
      j -= 1;
      continue;
    }
    const way = direction[i * width + (j - low(i))];
    if (way === 1) {
      pairs[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (way === 3 && j > 0) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return pairs;
}

/**
 * Lines up the script with the timed speech. The script is the truth for wording; the speech only
 * provides times. Script words that are not in the speech get times between their neighbours.
 */
export function alignScript(script: string, speech: readonly TimedWord[], options: AlignOptions = {}): AlignmentResult {
  const tokens = splitWords(script);
  const timed = explodeWords(speech);
  const scriptKeys = tokens.map(normalizeKey);
  const speechKeys = timed.map((word) => normalizeKey(word.text));
  const pairs = alignKeys(scriptKeys, speechKeys);

  const matched = pairs.map((j, i) => j >= 0 && similarKeys(scriptKeys[i] ?? "", speechKeys[j] ?? ""));
  const words: TimedWord[] = tokens.map((text, i) => {
    const j = pairs[i] ?? -1;
    const source = j >= 0 && matched[i] ? timed[j] : undefined;
    return { text, start: source?.start ?? Number.NaN, end: source?.end ?? Number.NaN };
  });
  fillGaps(words, options.voiceDuration ?? timed[timed.length - 1]?.end ?? 0);
  enforceOrder(words);

  const quality = tokens.length === 0 ? 0 : Math.round((matched.filter(Boolean).length / tokens.length) * 1000) / 10;
  return { words, matched, quality };
}

/** Gives words without a time a share of the time between the words around them. */
function fillGaps(words: TimedWord[], endLimit: number): void {
  const known = words.map((word) => !Number.isNaN(word.start));
  const firstKnown = known.indexOf(true);
  if (firstKnown === -1) {
    // Nothing matched at all: spread the words evenly over the voice.
    const step = endLimit / Math.max(1, words.length);
    words.forEach((word, index) => {
      word.start = round(index * step);
      word.end = round((index + 1) * step);
    });
    return;
  }
  const durations = words.filter((_, i) => known[i]).map((word) => word.end - word.start);
  const average = durations.reduce((sum, d) => sum + d, 0) / Math.max(1, durations.length);

  let index = 0;
  while (index < words.length) {
    if (known[index]) {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < words.length && !known[runEnd]) runEnd += 1;
    const before = index > 0 ? words[index - 1] : undefined;
    const after = runEnd < words.length ? words[runEnd] : undefined;
    const run = words.slice(index, runEnd);
    const weights = run.map((word) => Math.max(1, letterCount(word.text)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let from = before?.end ?? 0;
    let to = after?.start ?? endLimit;
    if (!before && after) from = Math.max(0, to - average * run.length);
    if (!after && before) to = Math.max(from, Math.min(endLimit, from + average * run.length));
    if (to < from) to = from;
    let position = from;
    run.forEach((word, k) => {
      const end = k === run.length - 1 ? to : position + ((to - from) * (weights[k] ?? 1)) / total;
      word.start = round(position);
      word.end = round(end);
      position = end;
    });
    index = runEnd;
  }
}

/** No word starts before the one before it ends, and no word ends before it starts. */
function enforceOrder(words: TimedWord[]): void {
  let previousEnd = 0;
  for (const word of words) {
    word.start = Math.max(word.start, previousEnd);
    word.end = Math.max(word.end, word.start);
    previousEnd = word.end;
  }
}
