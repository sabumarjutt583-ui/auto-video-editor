/** Layers 1 and 2: what Gemini is told, and the check of what it answers. */

import type { Character, DetailLevel, Location, OutputType, Scene } from "../../types/project.ts";
import type { StyleProfile } from "../../types/style.ts";
import type { AspectRatio } from "../../types/settings.ts";
import { extractJson } from "../scenes/ai.ts";
import { needsMotion } from "./assemble.ts";

export const DETAIL_WORDS: Record<DetailLevel, number> = { short: 40, medium: 70, detailed: 120 };

export const BATCH_SIZE = 20;

export interface SystemInput {
  style: StyleProfile;
  characters: readonly Character[];
  locations: readonly Location[];
  detail: DetailLevel;
  outputType: OutputType;
  aspect: AspectRatio;
}

/** Layer 1: the full style profile, the rules, and the character and location bible. */
export function buildSystemInstruction(input: SystemInput): string {
  const { style, characters, locations, detail, outputType, aspect } = input;
  const words = DETAIL_WORDS[detail];
  const profile = [
    ["Name", style.name],
    ["Category", style.category],
    ["Core identity", style.core_identity],
    ["Medium", style.medium],
    ["Lighting", style.lighting],
    ["Color palette", style.color_palette],
    ["Camera", style.camera],
    ["Composition", style.composition],
    ["Texture", style.texture],
    ["Characters", style.characters],
    ["Mood", style.mood],
    ["Negative (never show)", style.negative],
    ["Motion rules", style.motion_rules],
    ["Style lock", style.style_lock],
    ["Example prompt", style.example_prompt],
  ]
    .map(([label, value]) => `- ${label}: ${value}`)
    .join("\n");

  const people = characters.length === 0 ? "(no named characters)" : characters.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.appearance}`).join("\n");
  const places = locations.length === 0 ? "(no fixed locations)" : locations.map((l) => `- ${l.name}: ${l.description}`).join("\n");
  const motionRule =
    outputType === "image"
      ? 'Write "motion" only for scenes marked video; use an empty string for image scenes.'
      : 'For every scene also write "motion": ONE camera move plus the subject movement, following the style\'s motion rules, ending with the duration in seconds (the scene length rounded).';

  return [
    "You write the scene descriptions for the pictures of a narrated video. A program adds the characters' looks, the location text and the style words afterwards, so you only describe the moment.",
    "",
    "STYLE PROFILE (the look of every picture):",
    profile,
    "",
    "CHARACTER BIBLE (for your understanding only):",
    people,
    "",
    "LOCATION BIBLE (for your understanding only):",
    places,
    "",
    "RULES:",
    `- Write each description in English, about ${words} words: who, where, action, emotion, shot type, lighting moment. Frame for ${aspect}.`,
    "- Do NOT describe how characters look (age, hair, clothes, face): the program inserts that. Use their names exactly as in the bible, consistently.",
    "- No text, letters, numbers, captions or logos in the picture. No brand, artist or studio names.",
    "- Each scene must visually match its narration line and continue the story from the scenes before it.",
    `- ${motionRule}`,
    '- Output strict JSON only, no other words: [{"id":"S01","scene":"...","motion":"..."}] with exactly the scene IDs given, in the same order.',
  ].join("\n");
}

export interface BatchScene {
  scene: Scene;
  characters: readonly Character[];
  location: Location | null;
}

/** Layer 2 input: the story so far and the scenes of this batch, one per line. */
export function buildBatchPrompt(batch: readonly BatchScene[], summary: string, outputType: OutputType): string {
  const lines = batch.map(({ scene, characters, location }) => {
    const cast = characters.map((c) => c.name || c.id).join(", ") || "none";
    const media = needsMotion(scene, outputType) ? "video/motion" : "image";
    const length = scene.duration > 0 ? `${scene.duration.toFixed(1)} s | ` : "";
    return `${scene.id} | ${length}${media} | cast: ${cast} | place: ${location?.name || "unspecified"} | narration: ${scene.text.replace(/\s+/g, " ").trim()}`;
  });
  return `Story so far: ${summary}\n\nWrite the descriptions for these scenes:\n${lines.join("\n")}`;
}

export interface Described {
  id: string;
  scene: string;
  motion: string;
}

/**
 * Checks Gemini's answer: a JSON list with exactly the wanted ids in the same order, each with a
 * non-empty scene description. Returns null when it cannot be used.
 */
export function parseBatch(answer: string, ids: readonly string[]): Described[] | null {
  let data = extractJson(answer);
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    data = Object.values(data as Record<string, unknown>).find(Array.isArray) ?? null;
  }
  if (!Array.isArray(data) || data.length !== ids.length) return null;
  const result: Described[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const entry: unknown = data[i];
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const scene = typeof record.scene === "string" ? record.scene.trim() : typeof record.description === "string" ? record.description.trim() : "";
    if (record.id !== ids[i] || scene === "") return null;
    result.push({ id: ids[i] ?? "", scene, motion: typeof record.motion === "string" ? record.motion.trim() : "" });
  }
  return result;
}
