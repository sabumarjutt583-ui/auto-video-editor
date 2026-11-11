import { validTimingRanges } from "./schedule.ts";
import { splitSentences, type Sentence } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";
import type { Scene, SceneSettings } from "../../types/project.ts";
import { assembleScenes } from "./assemble.ts";
import { groupByCount, type Unit } from "./units.ts";
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

/** Per Seconds: nearest boundary between words, independent of sentence length. */
export function buildBySeconds({ words, voiceDuration, settings }: BuildInput, targetSeconds = settings.targetSeconds): Scene[] {
  if (words.length === 0) return [];
  const sentences = splitSentences(words);
  const saved = settings.mode === "seconds" ? validTimingRanges(settings.timingRanges) : [];
  const ranges = saved.length ? saved : [{ startSeconds: 0, targetSeconds: Number.isFinite(targetSeconds) ? Math.max(1, Math.min(60, targetSeconds)) : FALLBACK_SECONDS }];
  const rangeAt = (time: number) => [...ranges].reverse().find(r => r.startSeconds <= time) ?? ranges[0];
  const units: Unit[] = [];
  let first = 0;
  while (first < words.length) {
    const start = first === 0 ? 0 : words[first].start;
    const range = rangeAt(start);
    const nextRange = ranges.find(r => r.startSeconds > start);
    const target = Math.min(start + range.targetSeconds, nextRange?.startSeconds ?? Infinity);
    // Compare the closest valid boundaries on either side, including the audio end.
    const timeAt = (index: number) => index === words.length ? voiceDuration : words[index].start;
    const validCut = (index: number) => index === words.length ||
      (words[index].start > start && words[index].start >= words[index - 1].end);
    let next = first + 1;
    while (next < words.length && words[next].start < target) next++;
    let before = next - 1;
    while (before > first && !validCut(before)) before--;
    while (next < words.length && !validCut(next)) next++;
    if (before > first && Math.abs(timeAt(before) - target) < Math.abs(timeAt(next) - target)) next = before;
    units.push({ firstWord: first, lastWord: next - 1 });
    first = next;
  }
  return finish(assembleScenes(units, units.map((_, i) => [i, i] as [number, number]), words, sentences, voiceDuration), words, sentences, voiceDuration, { ...settings, minSeconds: 0 });
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
