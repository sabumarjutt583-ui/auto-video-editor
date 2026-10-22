import type { AnalyzeAnswer, AnalyzeEngine } from "../../types/customStyle.ts";
import type { StyleProfile } from "../../types/style.ts";
import { BANNED_NAMES, bannedHits, completeProblems } from "../styleChecks.ts";
import { blankStyle, MY_STYLES } from "../styleModel.ts";

export const MIN_IMAGES = 3;
export const MAX_IMAGES = 4;
export const PICTURE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
export const SAMPLE_PROMPTS = 3;

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface PictureSplit {
  /** Pictures that fit, in order. */
  accepted: string[];
  /** Files that are not PNG, JPG or WebP. */
  notPictures: string[];
  /** Pictures left out because the limit of 4 is reached. */
  tooMany: string[];
}

/** From dropped or chosen files: the pictures that fit in the free places, and what was left out. */
export function splitPictures(paths: readonly string[], alreadyHave: number): PictureSplit {
  const pictures = paths.filter((p) => (PICTURE_EXTENSIONS as readonly string[]).includes(extensionOf(p)));
  const notPictures = paths.filter((p) => !pictures.includes(p));
  const room = Math.max(0, MAX_IMAGES - alreadyHave);
  return { accepted: pictures.slice(0, room), notPictures, tooMany: pictures.slice(room) };
}

/** Why Analyze cannot start yet, or null when it can. */
export function analyzeBlocker(name: string, imageCount: number): string | null {
  if (name.trim() === "") return "Please give the style a name.";
  const banned = nameProblems(name);
  if (banned.length > 0) return banned[0] ?? null;
  if (imageCount < MIN_IMAGES) return `Please add ${MIN_IMAGES} or ${MAX_IMAGES} reference pictures (${imageCount} so far).`;
  return null;
}

/** Brand names are not allowed in a style, its name included. */
export function nameProblems(name: string): string[] {
  const hits = bannedHits({ ...blankStyle(), name }, BANNED_NAMES).filter((hit) => hit.endsWith("(in name)"));
  return hits.length > 0 ? ["Please do not use brand or studio names in the style name."] : [];
}

/** Puts the draft of the AI together with what the person chose: the id, name, category and version are never the AI's. */
export function finishDraft(draft: StyleProfile, choice: { id: string; name: string; category: string }): StyleProfile {
  return { ...draft, id: choice.id, name: choice.name.trim(), category: choice.category.trim() || MY_STYLES, version: "1.0.0", builtin: false };
}

/** The rules a finished style must pass (the same rules as `npm run styles:check`). Empty list = passes. */
export function checkDraft(style: StyleProfile): string[] {
  return completeProblems(style, `${style.id}.json`, BANNED_NAMES);
}

export interface Analysis {
  style: StyleProfile;
  /** Rules still broken after the one retry (empty = the style passes). */
  problems: string[];
  /** The AI had to be asked a second time. */
  retried: boolean;
}

/**
 * Asks the AI, checks the answer against the writing rules and, when it breaks any, asks once more with the
 * list of problems. Whatever the second answer is, it is returned with the problems that remain.
 */
export async function analyzeWithRetry(
  ask: (problems: string[], previous: string | null) => Promise<AnalyzeAnswer>,
  finish: (draft: StyleProfile) => StyleProfile,
): Promise<Analysis> {
  const first = await ask([], null);
  const firstStyle = finish(first.style);
  const firstProblems = checkDraft(firstStyle);
  if (firstProblems.length === 0) return { style: firstStyle, problems: [], retried: false };
  const second = await ask(firstProblems, first.raw);
  const secondStyle = finish(second.style);
  return { style: secondStyle, problems: checkDraft(secondStyle), retried: true };
}

export interface EngineChoice {
  value: AnalyzeEngine;
  label: string;
  /** Why it cannot be used yet, or null. */
  unavailable: string | null;
}

/** The engines to choose from, with the reason when one needs a key first. */
export function engineChoices(keys: { gemini: boolean; openai: boolean }): EngineChoice[] {
  return [
    { value: "gemini", label: "Gemini (API key)", unavailable: keys.gemini ? null : "Add your Gemini key in Settings first." },
    { value: "openai", label: "OpenAI (API key)", unavailable: keys.openai ? null : "Add your OpenAI key in Settings first." },
    { value: "chat", label: "Gemini web chat (Google accounts)", unavailable: null },
  ];
}

/** The engine to start with: the web chat when Settings uses it for texts, else a key that is set. */
export function defaultEngine(keys: { gemini: boolean; openai: boolean }, textViaChat: boolean): AnalyzeEngine {
  if (textViaChat) return "chat";
  if (keys.gemini) return "gemini";
  if (keys.openai) return "openai";
  return "chat";
}

/** Whether a finished prompt ends with the style lock (the acceptance rule for every prompt of a style). */
export function endsWithLock(prompt: string, style: Pick<StyleProfile, "style_lock">): boolean {
  const lock = style.style_lock.trim();
  return lock !== "" && prompt.trim().endsWith(lock);
}
