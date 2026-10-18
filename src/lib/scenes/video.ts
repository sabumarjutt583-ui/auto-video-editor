import { PAUSE_SECONDS } from "./units.ts";
import type { Sentence } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";
import type { Scene } from "../../types/project.ts";
import { renumber, retime, wordSentenceMap, wordsText } from "./assemble.ts";

/** A place inside a scene where it can be cut: just before word `wordIndex`. */
export interface Boundary {
  wordIndex: number;
  /** The cut is at the start of a sentence. */
  sentenceStart: boolean;
  /** Silence before this word, in seconds. */
  pause: number;
}

/** Every possible cut inside the scene. */
export function boundaries(scene: Scene, words: readonly TimedWord[], sentences: readonly Sentence[]): Boundary[] {
  const starts = new Set(sentences.map((sentence) => sentence.firstWord));
  const result: Boundary[] = [];
  for (let w = scene.firstWord + 1; w <= scene.lastWord; w += 1) {
    const previous = words[w - 1];
    const word = words[w];
    if (!previous || !word) continue;
    result.push({ wordIndex: w, sentenceStart: starts.has(w), pause: Math.max(0, word.start - previous.end) });
  }
  return result;
}

/** The cuts a person can choose for "split here": sentence starts, or else pauses and commas. */
export function splitChoices(scene: Scene, words: readonly TimedWord[], sentences: readonly Sentence[]): Boundary[] {
  const all = boundaries(scene, words, sentences);
  const bySentence = all.filter((b) => b.sentenceStart);
  if (bySentence.length > 0) return bySentence;
  const byPause = all.filter((b) => b.pause >= PAUSE_SECONDS || /[,，、،;；:：]$/u.test(words[b.wordIndex - 1]?.text ?? ""));
  return byPause.length > 0 ? byPause : all;
}

/** Cuts a scene before the given words (sorted, inside the scene) into several scenes. Times are set afterwards by `retime`. */
export function splitBefore(scene: Scene, cuts: readonly number[], words: readonly TimedWord[], sentences: readonly Sentence[]): Scene[] {
  const sentenceOf = wordSentenceMap(sentences, words.length);
  const edges = [scene.firstWord, ...cuts, scene.lastWord + 1];
  const parts: Scene[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const firstWord = edges[i] ?? 0;
    const lastWord = (edges[i + 1] ?? 0) - 1;
    parts.push({
      ...scene,
      id: `${scene.id.replace(/[a-z]$/, "")}${String.fromCharCode(97 + i)}`,
      start: i === 0 ? scene.start : (words[firstWord]?.start ?? scene.start),
      firstWord,
      lastWord,
      firstSentence: sentenceOf[firstWord] ?? scene.firstSentence,
      lastSentence: sentenceOf[lastWord] ?? scene.lastSentence,
      text: wordsText(words, firstWord, lastWord),
      // The old picture description no longer fits.
      prompt: "",
      motionPrompt: "",
      description: "",
      negative: "",
      edited: false,
      matchedFile: null,
      status: "pending",
    });
  }
  return parts;
}

/**
 * Cuts a video scene longer than `max` seconds into equal-ish parts at the best sentence or pause.
 * Returns the scene itself when it is short enough.
 */
export function splitVideoScene(scene: Scene, words: readonly TimedWord[], sentences: readonly Sentence[], max: number): number[] {
  if (scene.duration <= max || scene.lastWord <= scene.firstWord) return [];
  const options = boundaries(scene, words, sentences);
  if (options.length === 0) return [];
  const startAt = (w: number) => (w === scene.firstWord ? scene.start : (words[w]?.start ?? 0));

  for (let parts = Math.max(2, Math.ceil(scene.duration / max)); parts <= options.length + 1 && parts <= 40; parts += 1) {
    const chosen: number[] = [];
    let previous = scene.firstWord;
    for (let p = 1; p < parts; p += 1) {
      const ideal = scene.start + (scene.duration * p) / parts;
      let best: Boundary | undefined;
      let bestScore = Infinity;
      for (const option of options) {
        if (option.wordIndex <= previous) continue;
        // Prefer sentence starts, then pauses; never stray far from the even spacing.
        const bonus = option.sentenceStart ? 1.2 : Math.min(option.pause, 1) * 0.8;
        const score = Math.abs(startAt(option.wordIndex) - ideal) - bonus;
        if (score < bestScore) {
          bestScore = score;
          best = option;
        }
      }
      if (!best) break;
      chosen.push(best.wordIndex);
      previous = best.wordIndex;
    }
    if (chosen.length !== parts - 1) continue;
    const edges = [scene.firstWord, ...chosen];
    const tooLong = edges.some((first, i) => {
      const end = i + 1 < edges.length ? startAt(edges[i + 1] ?? 0) : scene.end;
      return end - startAt(first) > max + 1e-9;
    });
    if (!tooLong) return chosen;
  }
  return [];
}

/** Splits every video scene that is longer than `max`. Image scenes are left alone. */
export function splitLongVideoScenes(scenes: readonly Scene[], words: readonly TimedWord[], sentences: readonly Sentence[], voiceDuration: number, max: number): Scene[] {
  const result: Scene[] = [];
  for (const scene of scenes) {
    const cuts = scene.mediaType === "video" ? splitVideoScene(scene, words, sentences, max) : [];
    if (cuts.length === 0) result.push(scene);
    else result.push(...splitBefore(scene, cuts, words, sentences));
  }
  return renumber(retime(result, words, voiceDuration));
}
