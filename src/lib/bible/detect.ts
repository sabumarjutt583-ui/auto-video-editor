/** Asking Gemini for the characters, the locations and who is in which scene, and checking the answer. */

import type { Character, Location } from "../../types/project.ts";
import { extractJson } from "../scenes/ai.ts";

export const BIBLE_SYSTEM_INSTRUCTION =
  "You are a script supervisor who keeps characters and places looking the same in every picture of a video. " +
  "You receive a narration (in any language) split into scenes with ids. " +
  "1) List the recurring people who matter to the story (named or clearly distinct, e.g. 'the grandmother'). " +
  "Do not list the narrator, the audience, or crowds. If the narration has no people (for example a documentary about places), return an empty characters list. " +
  "For each person give ONE fixed English description in appearance_en: age, gender, ethnicity if stated or implied by the story setting, face, hair, body, clothing and one distinctive detail. " +
  "2) List the main places in locations, each with a fixed English description_en (setting, time of day if constant, key objects, atmosphere). " +
  "3) For every scene id say which character ids and which one location id appear in it (use [] and null when none). " +
  "All names may stay in the original language, but appearance_en and description_en must be English. " +
  'Answer with JSON only, in exactly this form: {"characters":[{"id":"c1","name":"","role":"","appearance_en":""}],"locations":[{"id":"l1","name":"","description_en":""}],"scenes":[{"id":"S01","characters":["c1"],"location":"l1"}]}';

export const CAST_ONLY_INSTRUCTION =
  "You receive a narration (in any language) split into scenes with ids, and a fixed list of characters and locations. " +
  "For every scene id say which character ids and which one location id appear in it (use [] and null when none). Use only the given ids. " +
  'Answer with JSON only, in exactly this form: {"scenes":[{"id":"S01","characters":["c1"],"location":"l1"}]}';

export interface SceneLine {
  id: string;
  text: string;
}

/** The scenes as numbered lines; together they hold the whole script. */
export function scenesPrompt(scenes: readonly SceneLine[]): string {
  return scenes.map((scene) => `${scene.id}: ${scene.text.replace(/\s+/g, " ").trim()}`).join("\n");
}

/** The prompt for "cast only": the fixed bible first, then the scenes. */
export function castOnlyPrompt(characters: readonly Character[], locations: readonly Location[], scenes: readonly SceneLine[]): string {
  const bible = {
    characters: characters.map((c) => ({ id: c.id, name: c.name, role: c.role })),
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
  };
  return `Bible:\n${JSON.stringify(bible)}\n\nScenes:\n${scenesPrompt(scenes)}`;
}

export interface SceneCast {
  characterIds: string[];
  locationId: string | null;
}

export interface Detected {
  characters: Character[];
  locations: Location[];
  cast: Record<string, SceneCast>;
}

const MAX_TEXT = 1200;

function text(value: unknown, limit = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanId(raw: unknown, prefix: string, used: Set<string>): string {
  let id = typeof raw === "string" ? raw.trim().replace(/[^A-Za-z0-9_-]/g, "") : "";
  if (id === "" || used.has(id)) {
    let n = used.size + 1;
    while (used.has(`${prefix}${n}`)) n += 1;
    id = `${prefix}${n}`;
  }
  used.add(id);
  return id;
}

/**
 * Reads Gemini's answer. Returns null when it is not usable (not JSON, or no `scenes` list).
 * With `known` given (cast-only mode) the characters and locations come from there.
 */
export function parseDetected(answer: string, sceneIds: readonly string[], known?: { characters: readonly Character[]; locations: readonly Location[] }): Detected | null {
  const data = extractJson(answer);
  if (!isObject(data)) return null;

  const characters: Character[] = [];
  const locations: Location[] = [];
  if (known) {
    characters.push(...known.characters);
    locations.push(...known.locations);
  } else {
    if (!Array.isArray(data.characters) || !Array.isArray(data.locations)) return null;
    const usedC = new Set<string>();
    for (const entry of data.characters) {
      if (!isObject(entry)) continue;
      const name = text(entry.name, 120);
      const appearance = text(entry.appearance_en ?? entry.appearance);
      if (name === "" && appearance === "") continue;
      characters.push({ id: cleanId(entry.id, "c", usedC), name, role: text(entry.role, 160), appearance });
    }
    const usedL = new Set<string>();
    for (const entry of data.locations) {
      if (!isObject(entry)) continue;
      const name = text(entry.name, 120);
      const description = text(entry.description_en ?? entry.description);
      if (name === "" && description === "") continue;
      locations.push({ id: cleanId(entry.id, "l", usedL), name, description });
    }
  }

  const knownCharacters = new Set(characters.map((c) => c.id));
  const knownLocations = new Set(locations.map((l) => l.id));
  const wanted = new Set(sceneIds);
  const cast: Record<string, SceneCast> = {};
  if (!Array.isArray(data.scenes)) return known ? null : { characters, locations, cast };
  for (const entry of data.scenes) {
    if (!isObject(entry) || typeof entry.id !== "string" || !wanted.has(entry.id)) continue;
    const ids = Array.isArray(entry.characters) ? entry.characters.filter((id): id is string => typeof id === "string" && knownCharacters.has(id)) : [];
    const location = typeof entry.location === "string" && knownLocations.has(entry.location) ? entry.location : null;
    cast[entry.id] = { characterIds: [...new Set(ids)], locationId: location };
  }
  return { characters, locations, cast };
}
