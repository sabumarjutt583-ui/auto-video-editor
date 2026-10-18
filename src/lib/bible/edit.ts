import type { Character, Location, Scene } from "../../types/project.ts";
import type { SceneCast } from "./detect.ts";

/** Puts the detected cast on the scenes (scenes Gemini did not mention get an empty cast). */
export function applyCast(scenes: readonly Scene[], cast: Readonly<Record<string, SceneCast>>): Scene[] {
  return scenes.map((scene) => {
    const entry = cast[scene.id];
    return { ...scene, characterIds: entry?.characterIds ?? [], locationId: entry?.locationId ?? null };
  });
}

/** Next free id such as "c3" or "l2". */
export function nextId(prefix: "c" | "l", existing: readonly { id: string }[]): string {
  const used = new Set(existing.map((item) => item.id));
  let n = existing.length + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function newCharacter(existing: readonly Character[]): Character {
  return { id: nextId("c", existing), name: "", role: "", appearance: "" };
}

export function newLocation(existing: readonly Location[]): Location {
  return { id: nextId("l", existing), name: "", description: "" };
}

/** Removes a character everywhere: from the list and from every scene's cast. */
export function removeCharacter(characters: readonly Character[], scenes: readonly Scene[], id: string): { characters: Character[]; scenes: Scene[] } {
  return {
    characters: characters.filter((c) => c.id !== id),
    scenes: scenes.map((scene) => (scene.characterIds.includes(id) ? { ...scene, characterIds: scene.characterIds.filter((c) => c !== id) } : scene)),
  };
}

export function removeLocation(locations: readonly Location[], scenes: readonly Scene[], id: string): { locations: Location[]; scenes: Scene[] } {
  return {
    locations: locations.filter((l) => l.id !== id),
    scenes: scenes.map((scene) => (scene.locationId === id ? { ...scene, locationId: null } : scene)),
  };
}

/** Adds the character to the scene, or removes it when it is already there. */
export function toggleCharacter(scenes: readonly Scene[], index: number, id: string): Scene[] {
  return scenes.map((scene, i) => {
    if (i !== index) return scene;
    const has = scene.characterIds.includes(id);
    return { ...scene, characterIds: has ? scene.characterIds.filter((c) => c !== id) : [...scene.characterIds, id] };
  });
}

export function setSceneLocation(scenes: readonly Scene[], index: number, id: string | null): Scene[] {
  return scenes.map((scene, i) => (i === index ? { ...scene, locationId: id } : scene));
}

/** How many scenes each character appears in. */
export function sceneCounts(scenes: readonly Scene[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const scene of scenes) for (const id of scene.characterIds) counts[id] = (counts[id] ?? 0) + 1;
  for (const scene of scenes) if (scene.locationId) counts[scene.locationId] = (counts[scene.locationId] ?? 0) + 1;
  return counts;
}
