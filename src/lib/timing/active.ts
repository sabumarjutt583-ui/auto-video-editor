import type { TimedWord } from "./types.ts";

/** Index of the word being spoken at `time` (or the last one that started), or -1 before the first. */
export function activeWordIndex(words: readonly TimedWord[], time: number): number {
  let low = 0;
  let high = words.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((words[middle]?.start ?? Infinity) <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
