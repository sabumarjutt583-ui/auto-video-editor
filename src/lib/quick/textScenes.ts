import { splitSentences } from "../sentences.ts";
import { splitWords } from "../text.ts";
import { emptyScene } from "../scenes/assemble.ts";
import { groupByCount } from "../scenes/units.ts";
import type { Scene } from "../../types/project.ts";

/** The id of the quick session (its folder is not in the projects folder). Same as QUICK_ID in Rust. */
export const QUICK_ID = "quick-session";

export type TextMode = "sentence" | "line" | "ai";

/** `P01`, `P02` ... (three digits from P100 on). Quick prompts without timing have no timecode. */
export function quickId(number: number): string {
  return `P${String(number).padStart(2, "0")}`;
}

export function isQuickId(id: string): boolean {
  return /^P\d{2,}$/.test(id);
}

/** The sentences of a pasted text, in any language (Latin, CJK, Devanagari, Urdu/Arabic ...). Never cut by length. */
export function splitTextSentences(text: string): string[] {
  const words = splitWords(text).map((token, index) => ({ text: token, start: index, end: index + 1 }));
  return splitSentences(words, { maxSeconds: Number.POSITIVE_INFINITY, maxWords: Number.POSITIVE_INFINITY }).map((s) => s.text.trim()).filter((t) => t !== "");
}

/** Every non-empty line of the text. */
export function splitTextLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

/** Scenes without timing: ids P01, P02 ..., all times 0, the text exactly as written. */
export function scenesFromTexts(texts: readonly string[]): Scene[] {
  return texts.map((text, i) => ({ ...emptyScene(), id: quickId(i + 1), index: i + 1, text }));
}

/** Per sentence: `perScene` sentences (1 to 4) make one prompt. */
export function bySentences(sentences: readonly string[], perScene: number): string[] {
  return groupByCount(sentences.length, perScene).map(([first, last]) => sentences.slice(first, last + 1).join(" "));
}

/** The sentences joined by Gemini's groups ([first, last], 0-based). */
export function byGroups(sentences: readonly string[], groups: readonly (readonly [number, number])[]): string[] {
  return groups.map(([first, last]) => sentences.slice(first, last + 1).join(" "));
}

/** Gemini's grouping could not be used: two sentences per scene is a safe middle. */
export const FALLBACK_PER_SCENE = 2;

/** Texts for the "text only" modes that need no AI. */
export function plainTexts(text: string, mode: "sentence" | "line", perScene: number): string[] {
  return mode === "line" ? splitTextLines(text) : bySentences(splitTextSentences(text), perScene);
}

/**
 * Builds the scenes again from a new text. Prompts the person already wrote are kept for scenes whose
 * text did not change, so editing the script does not throw away finished work.
 */
export function keepFinishedWork(next: readonly Scene[], old: readonly Scene[]): Scene[] {
  const byText = new Map(old.filter((s) => s.prompt.trim() !== "" || s.edited).map((s) => [s.text, s]));
  return next.map((scene) => {
    const before = byText.get(scene.text);
    return before ? { ...scene, prompt: before.prompt, motionPrompt: before.motionPrompt, description: before.description, negative: before.negative, edited: before.edited, characterIds: before.characterIds, locationId: before.locationId } : scene;
  });
}
