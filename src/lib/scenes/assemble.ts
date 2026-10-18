import { joinWords } from "../text.ts";
import type { Sentence } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";
import type { Scene } from "../../types/project.ts";
import { sceneId } from "./timecode.ts";
import type { Unit } from "./units.ts";

export function emptyScene(): Scene {
  return {
    id: "",
    index: 0,
    start: 0,
    end: 0,
    duration: 0,
    text: "",
    mediaType: "image",
    prompt: "",
    motionPrompt: "",
    matchedFile: null,
    status: "pending",
    firstSentence: 0,
    lastSentence: 0,
    firstWord: 0,
    lastWord: 0,
    description: "",
    edited: false,
    negative: "",
    characterIds: [],
    locationId: null,
  };
}

/** Index of the sentence each word belongs to. */
export function wordSentenceMap(sentences: readonly Sentence[], wordCount: number): number[] {
  const map = new Array<number>(wordCount).fill(0);
  for (const sentence of sentences) for (let w = sentence.firstWord; w <= sentence.lastWord; w += 1) map[w] = sentence.index;
  return map;
}

/** Text of words first..last, exactly as in the script. */
export function wordsText(words: readonly TimedWord[], first: number, last: number): string {
  return joinWords(words.slice(first, last + 1).map((word) => word.text));
}

/**
 * Sets every scene's start (first word; 0 for the first scene), end (start of the next scene; the
 * voice length for the last) and duration. Pauses belong to the scene before them: no gaps.
 */
export function retime(scenes: Scene[], words: readonly TimedWord[], voiceDuration: number): Scene[] {
  const starts = scenes.map((scene, i) => (i === 0 ? 0 : (words[scene.firstWord]?.start ?? scene.start)));
  return scenes.map((scene, i) => {
    const start = starts[i] ?? 0;
    const end = Math.max(start, i + 1 < scenes.length ? (starts[i + 1] ?? voiceDuration) : voiceDuration);
    return { ...scene, start, end, duration: end - start };
  });
}

/** Numbers scenes S01, S02, ... Neighbouring scenes that are parts of one scene (S05a, S05b) keep their letters. */
export function renumber(scenes: readonly Scene[]): Scene[] {
  const keys = scenes.map((scene) => {
    const match = /^S(\d+)([a-z]?)$/.exec(scene.id);
    return match && match[2] !== "" ? (match[1] ?? "") : null;
  });
  const result: Scene[] = [];
  let number = 0;
  let i = 0;
  while (i < scenes.length) {
    let j = i;
    const key = keys[i];
    while (key !== null && j + 1 < scenes.length && keys[j + 1] === key) j += 1;
    number += 1;
    for (let k = i; k <= j; k += 1) {
      const scene = scenes[k];
      if (scene) result.push({ ...scene, index: number, id: sceneId(number, j > i ? k - i : undefined) });
    }
    i = j + 1;
  }
  return result;
}

/** Turns groups of units into scenes with exact wording and no-gap timing. */
export function assembleScenes(
  units: readonly Unit[],
  groups: readonly (readonly [number, number])[],
  words: readonly TimedWord[],
  sentences: readonly Sentence[],
  voiceDuration: number,
): Scene[] {
  const sentenceOf = wordSentenceMap(sentences, words.length);
  const scenes = groups.map(([first, last]) => {
    const firstWord = units[first]?.firstWord ?? 0;
    const lastWord = units[last]?.lastWord ?? firstWord;
    return {
      ...emptyScene(),
      firstWord,
      lastWord,
      firstSentence: sentenceOf[firstWord] ?? 0,
      lastSentence: sentenceOf[lastWord] ?? 0,
      text: wordsText(words, firstWord, lastWord),
    };
  });
  return renumber(retime(scenes, words, voiceDuration));
}
