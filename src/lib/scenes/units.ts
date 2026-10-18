import type { TimedWord } from "../timing/types.ts";
import type { Sentence } from "../sentences.ts";

/** A piece of narration that a scene may start or end at: a sentence, or a clause of a long sentence. */
export interface Unit {
  firstWord: number;
  lastWord: number;
}

const BREAK_MARKS = /[,，、،;；:：]$/u;
/** A pause this long between two words is a good place to cut. */
export const PAUSE_SECONDS = 0.3;

/** Word indexes after which a clause could end (comma-like mark, or a pause). */
export function pauseBreaks(words: readonly TimedWord[], first: number, last: number): number[] {
  const breaks: number[] = [];
  for (let i = first; i < last; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    if (!word || !next) continue;
    if (BREAK_MARKS.test(word.text) || next.start - word.end >= PAUSE_SECONDS) breaks.push(i);
  }
  return breaks;
}

/**
 * Cuts words first..last at commas or pauses until every piece is at most `limit` seconds long
 * (or no break is left). Pieces aim for `target` seconds. Never cuts inside a word.
 */
export function splitAtPauses(words: readonly TimedWord[], first: number, last: number, target: number, limit: number): Unit[] {
  const pieces: Unit[] = [];
  let from = first;
  const length = (a: number, b: number) => (words[b]?.end ?? 0) - (words[a]?.start ?? 0);
  while (from < last && length(from, last) > limit) {
    const candidates = pauseBreaks(words, from, last);
    let best = -1;
    let bestScore = Infinity;
    for (const index of candidates) {
      const score = Math.abs(length(from, index) - target);
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best < 0) break;
    pieces.push({ firstWord: from, lastWord: best });
    from = best + 1;
  }
  pieces.push({ firstWord: from, lastWord: last });
  return pieces;
}

/** Sentences as units. Sentences longer than 1.5 x target are cut at commas and pauses. */
export function makeUnits(sentences: readonly Sentence[], words: readonly TimedWord[], target: number): Unit[] {
  const units: Unit[] = [];
  for (const sentence of sentences) {
    const seconds = sentence.end - sentence.start;
    if (seconds > target * 1.5) units.push(...splitAtPauses(words, sentence.firstWord, sentence.lastWord, target, target * 1.5));
    else units.push({ firstWord: sentence.firstWord, lastWord: sentence.lastWord });
  }
  return units;
}

/** Groups of consecutive units. Each group becomes one scene. Values are unit indexes. */
export type Groups = readonly (readonly [number, number])[];

/** Per Sentence: every `count` sentences make one scene. */
export function groupByCount(unitCount: number, count: number): [number, number][] {
  const size = Math.max(1, Math.floor(count));
  const groups: [number, number][] = [];
  for (let first = 0; first < unitCount; first += size) groups.push([first, Math.min(unitCount - 1, first + size - 1)]);
  return groups;
}

/**
 * Per Seconds: join units while that brings the scene closer to the target length.
 * A unit's length runs from its first word to the first word of the next unit, so pauses count.
 */
export function groupBySeconds(units: readonly Unit[], words: readonly TimedWord[], voiceDuration: number, target: number): [number, number][] {
  const startOf = (unit: Unit | undefined) => (unit ? (words[unit.firstWord]?.start ?? 0) : voiceDuration);
  const lengths = units.map((unit, i) => startOf(units[i + 1]) - startOf(unit));
  const groups: [number, number][] = [];
  let i = 0;
  while (i < units.length) {
    let total = lengths[i] ?? 0;
    let j = i;
    while (j + 1 < units.length && Math.abs(total + (lengths[j + 1] ?? 0) - target) < Math.abs(total - target)) {
      total += lengths[j + 1] ?? 0;
      j += 1;
    }
    groups.push([i, j]);
    i = j + 1;
  }
  return groups;
}
