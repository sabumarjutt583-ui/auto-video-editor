import type { EditorData, MatchHow, MediaFile } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { parseMediaName } from "./parseName.ts";

/** A file may differ this much (seconds) from the project's scene time before the user is asked. */
export const TIME_TOLERANCE = 0.3;

/** Works out which scene a file belongs to from its name. Files that match nothing stay unmatched. */
export function placeByName(file: MediaFile, scenes: readonly Scene[], keepManual = true): MediaFile {
  if (keepManual && (file.how === "order" || file.how === "gemini" || file.how === "manual" || file.how === "rename")) {
    // A choice the user (or Gemini) made: keep it while the scene still exists.
    if (file.sceneId !== null && scenes.some((s) => s.id === file.sceneId)) return file;
  }
  const parsed = parseMediaName(file.name);
  const known = parsed.sceneId !== null && scenes.some((s) => s.id === parsed.sceneId);
  const how: MatchHow | null = !known ? null : parsed.kind === "timecode" ? "name" : "number";
  return {
    ...file,
    sceneId: known ? parsed.sceneId : null,
    start: parsed.kind === "timecode" ? parsed.start : null,
    end: parsed.kind === "timecode" ? parsed.end : null,
    how,
    confidence: null,
  };
}

/** Every scene that has at least one file keeps a valid chosen file in the map; maps to missing files are dropped. */
export function chooseFiles(media: readonly MediaFile[], mediaMap: Readonly<Record<string, string>>, scenes: readonly Scene[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const scene of scenes) {
    const candidates = media.filter((m) => m.sceneId === scene.id);
    if (candidates.length === 0) continue;
    const current = mediaMap[scene.id];
    next[scene.id] = current !== undefined && candidates.some((m) => m.path === current) ? current : (candidates[0]?.path ?? "");
  }
  return next;
}

export interface Placement {
  media: MediaFile[];
  mediaMap: Record<string, string>;
}

/** Adds (or replaces, by path) files and places them by name. */
export function addFiles(editor: Pick<EditorData, "media">, mediaMap: Readonly<Record<string, string>>, scenes: readonly Scene[], files: readonly MediaFile[]): Placement {
  const incoming = new Set(files.map((f) => f.path));
  const kept = editor.media.filter((m) => !incoming.has(m.path));
  const media = [...kept, ...files.map((f) => placeByName(f, scenes, false))];
  return { media, mediaMap: chooseFiles(media, mediaMap, scenes) };
}

/** After the scenes changed (rebuilt, merged, split): places every file again and tidies the map. */
export function reconcile(editor: Pick<EditorData, "media">, mediaMap: Readonly<Record<string, string>>, scenes: readonly Scene[]): Placement {
  const media = editor.media.map((m) => placeByName(m, scenes));
  return { media, mediaMap: chooseFiles(media, mediaMap, scenes) };
}

/** Puts one file on one scene by hand. It becomes that scene's chosen file. */
export function assignFile(editor: Pick<EditorData, "media">, mediaMap: Readonly<Record<string, string>>, scenes: readonly Scene[], path: string, sceneId: string | null, how: MatchHow = "manual", confidence: number | null = null): Placement {
  const media = editor.media.map((m) => (m.path === path ? { ...m, sceneId, how: sceneId === null ? null : how, confidence: sceneId === null ? null : confidence } : m));
  const map = { ...mediaMap };
  if (sceneId !== null) map[sceneId] = path;
  return { media, mediaMap: chooseFiles(media, map, scenes) };
}

/** Picks which of several files for one scene is used. */
export function chooseFor(mediaMap: Readonly<Record<string, string>>, sceneId: string, path: string): Record<string, string> {
  return { ...mediaMap, [sceneId]: path };
}

/** Files that belong to no scene. */
export function unmatched(media: readonly MediaFile[]): MediaFile[] {
  return media.filter((m) => m.sceneId === null);
}

/** Scenes that have no file at all. */
export function emptyScenes(media: readonly MediaFile[], scenes: readonly Scene[], exists: Readonly<Record<string, boolean>> = {}): Scene[] {
  // A file that was deleted from the project folder does not count.
  const used = new Set(media.filter((m) => exists[m.path] !== false).map((m) => m.sceneId));
  return scenes.filter((s) => !used.has(s.id));
}

/** Fills empty scenes, in scene order, with unmatched files, in the order given. */
export function matchByOrder(media: readonly MediaFile[], scenes: readonly Scene[], order: readonly MediaFile[], exists: Readonly<Record<string, boolean>> = {}): { sceneId: string; path: string }[] {
  const free = order.filter((f) => f.sceneId === null);
  const empty = emptyScenes(media, scenes, exists);
  const count = Math.min(free.length, empty.length);
  const pairs: { sceneId: string; path: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const scene = empty[i];
    const file = free[i];
    if (scene && file) pairs.push({ sceneId: scene.id, path: file.path });
  }
  return pairs;
}
