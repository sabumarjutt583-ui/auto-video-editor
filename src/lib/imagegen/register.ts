import type { MediaFile } from "../../types/editor.ts";
import type { MediaInfo, SavedImage } from "../../types/imagegen.ts";
import type { Project, ProjectPatch } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";
import { fromImported } from "../media/files.ts";
import { addFiles, chooseFor } from "../media/place.ts";

type Registered = Pick<SavedImage, "sceneId" | "path" | "name" | "width" | "height" | "modified"> & { regenerated?: boolean };

/**
 * Puts a saved picture into the project so the Auto Editor's timeline shows it: the file joins the media
 * list (matched to its scene by the timecode in its name), becomes the scene's chosen file when it is a new
 * picture, and the scene's `matchedFile` points at it. Returns `null` when nothing would change.
 */
export function registerImage(project: Pick<Project, "scenes" | "mediaMap" | "editor">, image: Registered): ProjectPatch | null {
  const scene = project.scenes.find((s) => s.id === image.sceneId);
  if (!scene) return null;
  const editor = readEditor(project);
  const alreadyListed = editor.media.some((m) => m.path === image.path && m.sceneId === image.sceneId);
  const chosen = project.mediaMap[image.sceneId] === image.path;
  const regenerated = image.regenerated === true;
  if (alreadyListed && scene.matchedFile === image.path && (chosen || !regenerated)) return null;

  const file: MediaFile = fromImported({ source: "", name: image.name, path: image.path, kind: "image", width: image.width, height: image.height, duration: 0, modified: image.modified });
  const placed = addFiles(editor, project.mediaMap, project.scenes, [file]);
  // A new picture for a scene that had one (Regenerate) becomes the one that is used.
  const mediaMap = regenerated || !project.mediaMap[image.sceneId] ? chooseFor(placed.mediaMap, image.sceneId, image.path) : placed.mediaMap;
  const scenes = project.scenes.map((s) => (s.id === image.sceneId ? { ...s, matchedFile: mediaMap[image.sceneId] ?? image.path, status: "matched" as const } : s));
  return { editor: { ...editor, media: placed.media }, mediaMap, scenes };
}

/** Finished jobs whose picture is not in the project's media list yet (a missed event, a restart, an Undo). */
export function unregisteredFiles(project: Pick<Project, "editor">, jobs: readonly { id: string; status: string; file: string | null }[]): { sceneId: string; path: string }[] {
  const listed = new Set(readEditor(project).media.map((m) => m.path));
  return jobs.filter((j) => j.status === "completed" && j.file !== null && !listed.has(j.file)).map((j) => ({ sceneId: j.id, path: j.file ?? "" }));
}

/** Joins the file facts from Rust with the scene id. */
export function withScene(info: MediaInfo, sceneId: string): Registered {
  return { sceneId, path: info.path, name: info.name, width: info.width, height: info.height, modified: info.modified };
}
