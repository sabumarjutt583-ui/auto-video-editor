import type { Sentence } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";
import type { Scene } from "../../types/project.ts";
import { renumber, retime, wordSentenceMap, wordsText } from "./assemble.ts";

/** The shortest scene length in seconds (a setting; shorter scenes are joined to a neighbour). */
export const DEFAULT_MIN_SECONDS = 2;

/**
 * Joins every scene shorter than `minSeconds` into the scene before it (into the next one when it is the first),
 * then renumbers the ids and re-times the scenes, so the timecodes follow. Text stays the exact words of the narration.
 */
export function mergeShortScenes(scenes: readonly Scene[], words: readonly TimedWord[], sentences: readonly Sentence[], voiceDuration: number, minSeconds = DEFAULT_MIN_SECONDS): Scene[] {
  if (!(minSeconds > 0) || scenes.length < 2 || words.length === 0) return [...scenes];
  const sentenceOf = wordSentenceMap(sentences, words.length);
  let list = [...scenes];
  for (;;) {
    const index = list.findIndex((scene) => scene.duration > 0 && scene.duration < minSeconds);
    if (index < 0 || list.length < 2) break;
    const into = index === 0 ? 1 : index - 1;
    const [first, second] = into < index ? [list[into], list[index]] : [list[index], list[into]];
    if (!first || !second) break;
    const firstWord = first.firstWord;
    const lastWord = second.lastWord;
    const merged: Scene = {
      ...first,
      firstWord,
      lastWord,
      firstSentence: sentenceOf[firstWord] ?? first.firstSentence,
      lastSentence: sentenceOf[lastWord] ?? second.lastSentence,
      text: wordsText(words, firstWord, lastWord),
      end: second.end,
      duration: second.end - first.start,
    };
    list = [...list.slice(0, Math.min(into, index)), merged, ...list.slice(Math.max(into, index) + 1)];
    list = retime(list, words, voiceDuration);
  }
  return renumber(list);
}
