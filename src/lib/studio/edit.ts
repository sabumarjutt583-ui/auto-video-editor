import { emptyScene } from "../scenes/assemble.ts";
import { readEditor } from "../editor/model.ts";
import type { EditorData, MediaFile } from "../../types/editor.ts";
import type { Project, ProjectPatch, Scene, Word } from "../../types/project.ts";

export const STUDIO_MIN_CLIP_SECONDS = 0.25;
export const STUDIO_MAX_CLIP_SECONDS = 4 * 3600;

export type StudioOperation =
  | { kind: "duration"; id: string; seconds: number }
  | { kind: "move"; id: string; index: number }
  | { kind: "delete"; id: string }
  | { kind: "split"; id: string; at: number }
  | { kind: "source-in"; id: string; seconds: number };

function finiteLength(value: number, label: string): number {
  if (!Number.isFinite(value) || value < STUDIO_MIN_CLIP_SECONDS || value > STUDIO_MAX_CLIP_SECONDS) {
    throw new Error(`${label} must be between 0.25 seconds and four hours.`);
  }
  return value;
}

function availableMedia(project: Project, scene: Scene, files: readonly MediaFile[]): MediaFile {
  const path = project.mediaMap[scene.id];
  const file = files.find((f) => f.path === path);
  if (!file) throw new Error(`Clip ${scene.id} is missing its imported source file.`);
  return file;
}

function nextSceneId(scenes: readonly Scene[]): string {
  const used = new Set(scenes.map((s) => s.id));
  let n = 1;
  while (used.has(`S${String(n).padStart(2, "0")}`)) n += 1;
  return `S${String(n).padStart(2, "0")}`;
}

function adjustMotion(before: readonly Scene[], after: readonly Scene[], editor: EditorData): EditorData["motion"] {
  const oldById = new Map(before.map((scene) => [scene.id, scene]));
  const newById = new Map(after.map((scene) => [scene.id, scene]));
  return editor.motion.flatMap((graphic) => {
    const oldScene = oldById.get(graphic.sceneId);
    const newScene = newById.get(graphic.sceneId);
    if (!oldScene || !newScene) return [];
    const offset = Math.max(0, graphic.start - oldScene.start);
    const shiftedStart = newScene.start + Math.min(offset, Math.max(0, newScene.duration - 0.01));
    return [{ ...graphic, start: shiftedStart, duration: Math.min(graphic.duration, Math.max(0.01, newScene.end - shiftedStart)) }];
  });
}

/** Changes actual source clip timing and scene order. This is NEVER called by the old scripted pipeline. */
export function editStudioTimeline(project: Project, operation: StudioOperation): ProjectPatch | null {
  if (project.scriptSource !== "video_studio" || project.voicePath !== null) {
    throw new Error("This editing operation is limited to standalone media-first Studio projects.");
  }
  const editor = readEditor(project);
  const atIndex = project.scenes.findIndex((scene) => scene.id === operation.id);
  if (atIndex < 0) return null;
  const current = project.scenes[atIndex]!;
  const scenes = [...project.scenes];
  const mediaMap = { ...project.mediaMap };
  const sourceIn = { ...editor.studioSourceIn };
  const file = availableMedia(project, current, editor.media);

  if (operation.kind === "duration") {
    scenes[atIndex] = { ...current, duration: finiteLength(operation.seconds, "Clip duration") };
  } else if (operation.kind === "move") {
    if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= scenes.length) return null;
    if (operation.index === atIndex) return null;
    scenes.splice(atIndex, 1);
    scenes.splice(operation.index, 0, current);
  } else if (operation.kind === "delete") {
    scenes.splice(atIndex, 1);
    delete mediaMap[current.id];
    delete sourceIn[current.id];
  } else if (operation.kind === "source-in") {
    if (file.kind !== "video") throw new Error("Source start trimming is available only for video clips.");
    const input = operation.seconds;
    if (!Number.isFinite(input) || input < 0 || input > file.duration - STUDIO_MIN_CLIP_SECONDS) {
      throw new Error("The source start must be inside the original video.");
    }
    sourceIn[current.id] = input;
  } else if (operation.kind === "split") {
    const at = operation.at;
    if (!Number.isFinite(at) || at < STUDIO_MIN_CLIP_SECONDS || at > current.duration - STUDIO_MIN_CLIP_SECONDS) {
      throw new Error("Split at least 0.25 seconds from either end of the clip.");
    }
    const start = sourceIn[current.id] ?? 0;
    if (file.kind === "video" && start + current.duration > file.duration + 0.01) {
      throw new Error("This video is shorter than the scene. Shorten the clip before splitting.");
    }
    const newId = nextSceneId(scenes);
    const second: Scene = {
      ...emptyScene(),
      ...current,
      id: newId,
      duration: current.duration - at,
      text: "",
      firstWord: 0,
      lastWord: 0,
      firstSentence: 0,
      lastSentence: 0,
    };
    scenes[atIndex] = { ...current, duration: at };
    scenes.splice(atIndex + 1, 0, second);
    mediaMap[newId] = mediaMap[current.id]!;
    if (file.kind === "video") sourceIn[newId] = start + at;
  }

  let time = 0;
  const words: Word[] = [];
  const nextScenes = scenes.map((scene, index): Scene => {
    const duration = finiteLength(scene.duration, "Clip duration");
    const start = time;
    time += duration;
    words.push({ text: `Scene${index + 1}`, start, end: time });
    return {
      ...scene, index: index + 1, start, end: time, duration,
      firstWord: index, lastWord: index, firstSentence: index, lastSentence: index,
    };
  });
  const active = new Set(nextScenes.map((scene) => scene.id));
  const overrides = Object.fromEntries(Object.entries(editor.overrides).filter(([id]) => active.has(id)));
  const media = editor.media.map((item) => {
    if (item.sceneId === null || active.has(item.sceneId)) return item;
    const replacement = nextScenes.find((scene) => mediaMap[scene.id] === item.path);
    return { ...item, sceneId: replacement?.id ?? null, how: replacement ? "manual" as const : null };
  });
  return {
    scenes: nextScenes,
    words,
    voiceDuration: time,
    mediaMap,
    editor: {
      ...editor,
      media,
      studioSourceIn: sourceIn,
      overrides,
      motion: adjustMotion(project.scenes, nextScenes, editor),
    },
  };
}

/** Keep all deliberate scene-to-file assignments when importing additional stock or user media. */
export function preserveStudioMediaMap(project: Project, nextMedia: readonly MediaFile[], candidate: Readonly<Record<string, string>>): Record<string, string> {
  if (project.scriptSource !== "video_studio") return { ...candidate };
  const paths = new Set(nextMedia.map((file) => file.path));
  const merged = { ...candidate };
  for (const scene of project.scenes) {
    const previous = project.mediaMap[scene.id];
    if (previous && paths.has(previous)) merged[scene.id] = previous;
  }
  return merged;
}
