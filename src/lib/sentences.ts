import { isNoSpaceChar, joinWords } from "./text.ts";
import type { TimedWord } from "./timing/types.ts";

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
  /** Index of the first and last word (in the word list) of this sentence. */
  firstWord: number;
  lastWord: number;
}

/** Marks that end a sentence: Latin, CJK, Devanagari danda, Urdu/Arabic. */
const TERMINATORS = new Set([".", "!", "?", "…", "。", "！", "？", "．", "｡", "।", "॥", "۔", "؟", "‼", "⁇", "⁈", "⁉", "‽"]);
const CLOSERS = new Set(['"', "'", "”", "’", "»", "」", "』", "）", ")", "]", "】", "〉", "》", "”", "’"]);
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "inc", "ltd", "co", "mt", "no", "vol", "fig",
  "approx", "dept", "est", "gen", "gov", "sen", "rep", "rev", "lt", "col", "capt", "sgt", "e.g", "i.e", "u.s",
  "u.k", "a.m", "p.m", "ph.d", "т.д", "т.п", "т.е", "см", "рис", "стр",
]);

function stripClosers(token: string): string {
  const chars = [...token];
  while (chars.length > 0 && CLOSERS.has(chars[chars.length - 1] ?? "")) chars.pop();
  return chars.join("");
}

function startsLowercase(token: string): boolean {
  const first = [...token].find((c) => /[\p{L}]/u.test(c));
  return first !== undefined && first !== first.toUpperCase() && first === first.toLowerCase() && !isNoSpaceChar(first);
}

/** True when the word ends a sentence. `next` is the following word, if any. */
export function endsSentence(token: string, next: string | undefined): boolean {
  const core = stripClosers(token);
  const last = [...core].pop() ?? "";
  if (!TERMINATORS.has(last)) return false;
  if (next === undefined) return true;

  if (last === "." || last === "．") {
    const word = core.replace(/[.．]+$/u, "").replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
    if (ABBREVIATIONS.has(word)) return false;
    if (/^\p{Lu}$/u.test(core.replace(/^[^\p{L}]+/u, "").slice(0, 1)) && /^[^\p{L}]*\p{Lu}\.$/u.test(core) && word !== "i" && word !== "a") return false;
    if (/\.\.\.$/.test(core)) return !startsLowercase(next);
    return !startsLowercase(next);
  }
  if (last === "…") return !startsLowercase(next);
  return true;
}

export interface SplitOptions {
  /** A sentence longer than this many seconds is split at its longest pause. */
  maxSeconds?: number;
  /** ...or longer than this many words. */
  maxWords?: number;
}

/** Cuts [first, last] at the longest pause until every part is short enough. */
function splitLong(words: readonly TimedWord[], first: number, last: number, maxSeconds: number, maxWords: number): [number, number][] {
  const count = last - first + 1;
  const seconds = (words[last]?.end ?? 0) - (words[first]?.start ?? 0);
  if ((seconds <= maxSeconds && count <= maxWords) || count < 8) return [[first, last]];
  let bestAt = -1;
  let bestGap = -1;
  for (let i = first + 3; i <= last - 3; i += 1) {
    const gap = (words[i + 1]?.start ?? 0) - (words[i]?.end ?? 0);
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = i;
    }
  }
  if (bestAt < 0) return [[first, last]];
  return [...splitLong(words, first, bestAt, maxSeconds, maxWords), ...splitLong(words, bestAt + 1, last, maxSeconds, maxWords)];
}

/** Splits timed words into sentences. Each sentence starts at its first word and ends at its last. */
export function splitSentences(words: readonly TimedWord[], options: SplitOptions = {}): Sentence[] {
  const maxSeconds = options.maxSeconds ?? 25;
  const maxWords = options.maxWords ?? 70;
  const ranges: [number, number][] = [];
  let first = 0;
  words.forEach((word, index) => {
    const isLast = index === words.length - 1;
    if (isLast || endsSentence(word.text, words[index + 1]?.text)) {
      ranges.push(...splitLong(words, first, index, maxSeconds, maxWords));
      first = index + 1;
    }
  });
  return ranges.map(([firstWord, lastWord], index) => ({
    index,
    text: joinWords(words.slice(firstWord, lastWord + 1).map((w) => w.text)),
    start: words[firstWord]?.start ?? 0,
    end: words[lastWord]?.end ?? 0,
    firstWord,
    lastWord,
  }));
}

/** Sentences where at least `threshold` of the words were not found in the speech. */
export function lowConfidenceSentences(sentences: readonly Sentence[], unmatched: ReadonlySet<number>, threshold = 0.34): Set<number> {
  const low = new Set<number>();
  for (const sentence of sentences) {
    const count = sentence.lastWord - sentence.firstWord + 1;
    let missing = 0;
    for (let w = sentence.firstWord; w <= sentence.lastWord; w += 1) if (unmatched.has(w)) missing += 1;
    if (count > 0 && missing / count >= threshold) low.add(sentence.index);
  }
  return low;
}
