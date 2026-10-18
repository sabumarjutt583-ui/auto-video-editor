import type { Scene } from "../../types/project.ts";
import { retime, wordSentenceMap, wordsText } from "../scenes/assemble.ts";
import type { Context } from "../scenes/edit.ts";

/** The range of words (indexes) whose start can become the boundary between scene `index` and the next one. */
export function boundaryRange(scenes: readonly Scene[], index: number): { min: number; max: number } | null {
  const left = scenes[index];
  const right = scenes[index + 1];
  if (!left || !right) return null;
  // Each scene keeps at least one word.
  return { min: left.firstWord + 1, max: right.lastWord };
}

/** The word start closest to `time` that the boundary may move to. */
export function nearestWord(scenes: readonly Scene[], index: number, time: number, context: Pick<Context, "words">): number | null {
  const range = boundaryRange(scenes, index);
  if (!range) return null;
  let best: number | null = null;
  let distance = Infinity;
  for (let w = range.min; w <= range.max; w += 1) {
    const word = context.words[w];
    if (!word) continue;
    const d = Math.abs(word.start - time);
    if (d < distance) {
      distance = d;
      best = w;
    }
  }
  return best;
}

/**
 * Moves the boundary between scene `index` and the next one so the right scene starts at word `wordIndex`.
 * Both scenes get the words they now cover (their wording follows the words) and no gap is left.
 */
export function moveBoundary(scenes: readonly Scene[], index: number, wordIndex: number, context: Context): Scene[] {
  const range = boundaryRange(scenes, index);
  const left = scenes[index];
  const right = scenes[index + 1];
  if (!range || !left || !right || wordIndex < range.min || wordIndex > range.max || wordIndex === right.firstWord) return [...scenes];
  const sentenceOf = wordSentenceMap(context.sentences, context.words.length);
  const nextLeft: Scene = {
    ...left,
    lastWord: wordIndex - 1,
    lastSentence: sentenceOf[wordIndex - 1] ?? left.lastSentence,
    text: wordsText(context.words, left.firstWord, wordIndex - 1),
  };
  const nextRight: Scene = {
    ...right,
    firstWord: wordIndex,
    firstSentence: sentenceOf[wordIndex] ?? right.firstSentence,
    text: wordsText(context.words, wordIndex, right.lastWord),
  };
  const next = scenes.map((scene, i) => (i === index ? nextLeft : i === index + 1 ? nextRight : scene));
  return retime(next, context.words, context.voiceDuration);
}

/** Like `moveBoundary`, but for a time in seconds: it snaps to the nearest allowed word start. */
export function moveBoundaryToTime(scenes: readonly Scene[], index: number, time: number, context: Context): Scene[] {
  const word = nearestWord(scenes, index, time, context);
  return word === null ? [...scenes] : moveBoundary(scenes, index, word, context);
}

/** Makes scene `index` follow a clip's own times: its start and end move (to the nearest words), neighbours give way. */
export function followFileTime(scenes: readonly Scene[], index: number, start: number, end: number, context: Context): Scene[] {
  let next = [...scenes];
  if (index > 0) next = moveBoundaryToTime(next, index - 1, start, context);
  if (index + 1 < next.length) next = moveBoundaryToTime(next, index, end, context);
  return next;
}
