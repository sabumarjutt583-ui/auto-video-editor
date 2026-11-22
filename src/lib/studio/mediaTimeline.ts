import { emptyScene } from "../scenes/assemble.ts";
import { naturalCompare } from "../media/files.ts";
import { readEditor } from "../editor/model.ts";
import type { Project, ProjectPatch, Scene, Word } from "../../types/project.ts";
import type { MediaFile } from "../../types/editor.ts";

export const DEFAULT_IMAGE_SECONDS = 5;
export const MAX_STUDIO_SCENES = 5000;

/**
 * Append imported media as real, editable scenes, independent of the script writer
 * and the existing production pipeline. Never renumber or replace old scenes.
 *
 * The placeholder words are timeline anchors, NOT a speech transcript.
 * Captions are disabled until an actual transcription is imported.
 */
export function appendStudioMedia(project: Project, imageSeconds = DEFAULT_IMAGE_SECONDS): ProjectPatch | null {
  const editor = readEditor(project);
  const occupied = new Set(Object.values(project.mediaMap));
  const files = editor.media
    .filter((file) => !occupied.has(file.path) && !project.scenes.some((scene) => scene.id === file.sceneId))
    .sort((a, b) => naturalCompare(a.name, b.name));
  if (!files.length) return null;
  if (project.scenes.length + files.length > MAX_STUDIO_SCENES) {
    throw new Error(`The editing studio supports up to ${MAX_STUDIO_SCENES} scenes in one video.`);
  }

  const seconds = Math.min(120, Math.max(0.5, Number.isFinite(imageSeconds) ? imageSeconds : DEFAULT_IMAGE_SECONDS));
  const scenes: Scene[] = [...project.scenes];
  const words: Word[] = [...project.words];
  const mediaMap = { ...project.mediaMap };
  const media = editor.media.map((item): MediaFile => ({ ...item }));
  const knownIds = new Set(scenes.map((scene) => scene.id));
  let nextId = 1;
  let cursor = Math.max(project.voiceDuration, ...scenes.map((scene) => scene.end), 0);

  for (const file of files) {
    while (knownIds.has(`S${String(nextId).padStart(2, "0")}`)) nextId += 1;
    const id = `S${String(nextId).padStart(2, "0")}`;
    knownIds.add(id);
    nextId += 1;
    const duration = file.kind === "video" && file.duration > 0
      ? Math.max(0.5, Math.min(30, file.duration))
      : seconds;
    const next = cursor + duration;
    const wordIndex = words.length;
    // One anchor per scene allows the existing word-snapping timeline to be reused.
    words.push({ text: `Scene${nextId - 1}`, start: cursor, end: next });
    scenes.push({
      ...emptyScene(),
      id,
      index: scenes.length + 1,
      start: cursor,
      end: next,
      duration,
      text: "",
      mediaType: file.kind,
      firstWord: wordIndex,
      lastWord: wordIndex,
      firstSentence: wordIndex,
      lastSentence: wordIndex,
      matchedFile: file.path,
      status: "matched",
    });
    mediaMap[id] = file.path;
    const entry = media.find((item) => item.path === file.path);
    if (entry) {
      entry.sceneId = id;
      entry.how = "manual";
      entry.confidence = null;
    }
    cursor = next;
  }

  return {
    scenes,
    words,
    voiceDuration: cursor,
    mediaMap,
    editor: {
      ...editor,
      media,
      // Filename/placeholder anchors must never appear as subtitles.
      captions: { ...editor.captions, style: { ...editor.captions.style, preset: "none" }, lines: null },
      // A media-only edit has no narration beats from which to plan automatic SFX.
      audio: { ...editor.audio, autoSfx: false, graphicSfx: false },
    },
  };
}
