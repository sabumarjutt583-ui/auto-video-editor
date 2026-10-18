import type { MediaFile } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";

export type SceneStatus = "ready" | "no_media" | "file_missing" | "short";

/** The file chosen for a scene, if it is one of the project's files. */
export function fileOf(scene: Pick<Scene, "id">, media: readonly MediaFile[], mediaMap: Readonly<Record<string, string>>): MediaFile | undefined {
  const path = mediaMap[scene.id];
  return path === undefined ? undefined : media.find((m) => m.path === path);
}

/** How well a scene is covered by its media. `exists` is the result of the last folder check. */
export function sceneStatus(
  scene: Pick<Scene, "id" | "duration">,
  file: MediaFile | undefined,
  exists: Readonly<Record<string, boolean>>,
  speed = 1,
): SceneStatus {
  if (!file) return "no_media";
  if (exists[file.path] === false) return "file_missing";
  if (file.kind === "video" && file.duration / Math.max(0.01, speed) < scene.duration - 0.05) return "short";
  return "ready";
}
