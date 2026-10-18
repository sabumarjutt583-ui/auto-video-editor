import type { Sentence } from "../sentences.ts";
import type { TimedWord } from "../timing/types.ts";
import type { MediaType, Scene } from "../../types/project.ts";
import { parseSceneId } from "./timecode.ts";
import { renumber, retime, wordsText } from "./assemble.ts";
import { splitBefore, splitVideoScene } from "./video.ts";

export interface Context {
  words: readonly TimedWord[];
  sentences: readonly Sentence[];
  voiceDuration: number;
  maxVideoSeconds: number;
}

/** Scenes lose their prompts when their wording or length changes. */
function cleared(scene: Scene): Scene {
  return { ...scene, prompt: "", motionPrompt: "", description: "", negative: "", edited: false, matchedFile: null, status: "pending" };
}

function done(scenes: Scene[], context: Context): Scene[] {
  return renumber(retime(scenes, context.words, context.voiceDuration));
}

/** Joins scene `index` with the one after it. */
export function mergeWithNext(scenes: readonly Scene[], index: number, context: Context): Scene[] {
  const a = scenes[index];
  const b = scenes[index + 1];
  if (!a || !b) return [...scenes];
  const merged: Scene = {
    ...cleared(a),
    lastWord: b.lastWord,
    lastSentence: b.lastSentence,
    text: wordsText(context.words, a.firstWord, b.lastWord),
    mediaType: a.mediaType === "video" || b.mediaType === "video" ? "video" : "image",
    characterIds: [...new Set([...a.characterIds, ...b.characterIds])],
    locationId: a.locationId ?? b.locationId,
  };
  const next = [...scenes.slice(0, index), merged, ...scenes.slice(index + 2)];
  return finishVideo(done(next, context), context);
}

/** Cuts scene `index` before word `wordIndex`. */
export function splitAtWord(scenes: readonly Scene[], index: number, wordIndex: number, context: Context): Scene[] {
  const scene = scenes[index];
  if (!scene || wordIndex <= scene.firstWord || wordIndex > scene.lastWord) return [...scenes];
  const parts = splitBefore(scene, [wordIndex], context.words, context.sentences).map(cleared);
  // The second half starts a new scene, unless the scene was already a part of a longer one.
  const isPart = parseSceneId(scene.id).part !== null;
  const fixed = parts.map((part, i) => (i === 1 && !isPart ? { ...part, id: `S${parseSceneId(scene.id).number + 1}` } : part));
  const next = [...scenes.slice(0, index), ...fixed, ...scenes.slice(index + 1)];
  return finishVideo(done(next, context), context);
}

/** Changes a scene to image or video. A video scene that is too long is split in parts; parts of an image are joined. */
export function setMediaType(scenes: readonly Scene[], index: number, mediaType: MediaType, context: Context): Scene[] {
  const scene = scenes[index];
  if (!scene || scene.mediaType === mediaType) return [...scenes];
  if (mediaType === "image") {
    // Join all parts of this scene into one image scene.
    const group = partRange(scenes, index);
    const first = scenes[group[0]];
    const last = scenes[group[1]];
    if (!first || !last) return [...scenes];
    const joined: Scene = { ...cleared(first), lastWord: last.lastWord, lastSentence: last.lastSentence, text: wordsText(context.words, first.firstWord, last.lastWord), mediaType };
    return done([...scenes.slice(0, group[0]), joined, ...scenes.slice(group[1] + 1)], context);
  }
  const updated = scenes.map((item, i) => (i === index ? { ...item, mediaType } : item));
  return finishVideo(done(updated, context), context);
}

/** The first and last index of the scenes that are parts of the same scene as `index`. */
export function partRange(scenes: readonly Scene[], index: number): [number, number] {
  const scene = scenes[index];
  if (!scene || parseSceneId(scene.id).part === null) return [index, index];
  const number = parseSceneId(scene.id).number;
  let first = index;
  let last = index;
  while (first > 0 && parseSceneId(scenes[first - 1]?.id ?? "").number === number && parseSceneId(scenes[first - 1]?.id ?? "").part !== null) first -= 1;
  while (last + 1 < scenes.length && parseSceneId(scenes[last + 1]?.id ?? "").number === number && parseSceneId(scenes[last + 1]?.id ?? "").part !== null) last += 1;
  return [first, last];
}

/** Splits video scenes that are longer than the maximum. */
export function finishVideo(scenes: Scene[], context: Context): Scene[] {
  const result: Scene[] = [];
  for (const scene of scenes) {
    const cuts = scene.mediaType === "video" ? splitVideoScene(scene, context.words, context.sentences, context.maxVideoSeconds) : [];
    if (cuts.length === 0) result.push(scene);
    else result.push(...splitBefore(scene, cuts, context.words, context.sentences));
  }
  return done(result, context);
}

/** Changes only the wording of a scene. Timing stays exactly as it was. */
export function editText(scenes: readonly Scene[], index: number, text: string): Scene[] {
  return scenes.map((scene, i) => (i === index ? { ...scene, text } : scene));
}

export interface SceneTotals {
  count: number;
  averageSeconds: number;
  longestSeconds: number;
  longestId: string;
  /** Image scenes longer than 12 seconds. */
  longImages: string[];
}

export const LONG_IMAGE_SECONDS = 12;

export function totals(scenes: readonly Scene[]): SceneTotals {
  if (scenes.length === 0) return { count: 0, averageSeconds: 0, longestSeconds: 0, longestId: "", longImages: [] };
  const sum = scenes.reduce((acc, scene) => acc + scene.duration, 0);
  const longest = scenes.reduce((best, scene) => (scene.duration > best.duration ? scene : best), scenes[0] as Scene);
  return {
    count: scenes.length,
    averageSeconds: sum / scenes.length,
    longestSeconds: longest.duration,
    longestId: longest.id,
    longImages: scenes.filter((scene) => scene.mediaType === "image" && scene.duration > LONG_IMAGE_SECONDS).map((scene) => scene.id),
  };
}
