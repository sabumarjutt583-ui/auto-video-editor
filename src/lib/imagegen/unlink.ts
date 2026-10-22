import type { Project, ProjectPatch } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";

/** Jobs that have a saved picture (the ones that can be deleted). */
export function pictureItems(jobs: readonly { id: string; file: string | null; status: string }[], only?: ReadonlySet<string>): { id: string; file: string }[] {
  return jobs.filter((j) => j.status === "completed" && j.file !== null && (!only || only.has(j.id))).map((j) => ({ id: j.id, file: j.file ?? "" }));
}

/**
 * After pictures were deleted: the scenes forget them (matchedFile empty, no chosen file), the editor's media list drops the files,
 * so the Auto Editor shows the scenes as missing media and the person can regenerate them.
 */
export function unlinkPictures(project: Pick<Project, "scenes" | "mediaMap" | "editor">, files: ReadonlySet<string>): ProjectPatch | null {
  if (files.size === 0) return null;
  const editor = readEditor(project);
  const media = editor.media.filter((m) => !files.has(m.path));
  const mediaMap = Object.fromEntries(Object.entries(project.mediaMap).filter(([, path]) => !files.has(path)));
  const scenes = project.scenes.map((scene) => {
    if (scene.matchedFile === null || !files.has(scene.matchedFile)) return scene;
    return { ...scene, matchedFile: null, status: scene.prompt.trim() !== "" ? ("prompt_ready" as const) : ("pending" as const) };
  });
  const changed = media.length !== editor.media.length || Object.keys(mediaMap).length !== Object.keys(project.mediaMap).length || scenes.some((s, i) => s !== project.scenes[i]);
  return changed ? { editor: { ...editor, media }, mediaMap, scenes } : null;
}
