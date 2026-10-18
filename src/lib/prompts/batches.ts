import type { Scene } from "../../types/project.ts";
import { BATCH_SIZE } from "./gemini.ts";

/** Scenes in groups of 20 (the last group may be smaller). */
export function planBatches<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？।۔؟])\s*/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * A three-sentence "story so far", built from the narration of the scenes before this batch:
 * how the story began, and the two most recent sentences. The first batch has no history.
 */
export function storySoFar(before: readonly Scene[], maxChars = 600): string {
  if (before.length === 0) return "This is the beginning of the story.";
  const all = before.flatMap((scene) => sentencesOf(scene.text));
  if (all.length === 0) return "The story has just begun.";
  const picked = all.length <= 3 ? all : [all[0] ?? "", all[all.length - 2] ?? "", all[all.length - 1] ?? ""];
  const text = picked.join(" ");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}
