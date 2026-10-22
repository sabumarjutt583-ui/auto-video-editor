import { splitSentences, type Sentence } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";
import type { Scene, SceneSettings } from "../../types/project.ts";
import { assembleScenes } from "./assemble.ts";
import { groupByCount, groupBySeconds, makeUnits, type Unit } from "./units.ts";
import { mergeShortScenes, DEFAULT_MIN_SECONDS } from "./short.ts";
import { splitLongVideoScenes } from "./video.ts";

/** What AI mode falls back to when Gemini's grouping cannot be used. */
export const FALLBACK_SECONDS = 5;

export interface BuildInput {
  words: readonly TimedWord[];
  voiceDuration: number;
  settings: SceneSettings;
}

function sentenceUnits(sentences: readonly Sentence[]): Unit[] {
  return sentences.map((sentence) => ({ firstWord: sentence.firstWord, lastWord: sentence.lastWord }));
}

/** Per Sentence: 1 to 4 sentences per scene. */
export function buildBySentences({ words, voiceDuration, settings }: BuildInput): Scene[] {
  const sentences = splitSentences(words);
  const units = sentenceUnits(sentences);
  const groups = groupByCount(units.length, settings.sentencesPerScene);
  return finish(assembleScenes(units, groups, words, sentences, voiceDuration), words, sentences, voiceDuration, settings);
}

/** Per Seconds: cut only at sentence ends (or at commas and pauses inside very long sentences). */
export function buildBySeconds({ words, voiceDuration, settings }: BuildInput, targetSeconds = settings.targetSeconds): Scene[] {
  const sentences = splitSentences(words);
  const units = makeUnits(sentences, words, targetSeconds);
  const groups = groupBySeconds(units, words, voiceDuration, targetSeconds);
  return finish(assembleScenes(units, groups, words, sentences, voiceDuration), words, sentences, voiceDuration, settings);
}

/** AI mode: `groups` are runs of sentences as [first, last] (0-based), already validated. */
export function buildFromSentenceGroups({ words, voiceDuration, settings }: BuildInput, groups: readonly (readonly [number, number])[]): Scene[] {
  const sentences = splitSentences(words);
  const units = sentenceUnits(sentences);
  return finish(assembleScenes(units, groups, words, sentences, voiceDuration), words, sentences, voiceDuration, settings);
}

function finish(scenes: Scene[], words: readonly TimedWord[], sentences: readonly Sentence[], voiceDuration: number, settings: SceneSettings): Scene[] {
  // New scenes are images. Video scenes are split when the user switches them (see edit.ts).
  const merged = mergeShortScenes(scenes, words, sentences, voiceDuration, settings.minSeconds ?? DEFAULT_MIN_SECONDS);
  return splitLongVideoScenes(merged, words, sentences, voiceDuration, settings.maxVideoSeconds);
}
