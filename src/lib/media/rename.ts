import type { SourceMedia } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { formatTimecode } from "../scenes/timecode.ts";
import { extensionOf } from "./files.ts";

export interface RenameRow {
  file: SourceMedia;
  /** The scene this file becomes, or null when there are more files than scenes. */
  sceneId: string | null;
  /** The new file name (the timecode), or null when there is no scene left. */
  newName: string | null;
  /** True when the file is a picture but the scene was planned as a video (or the other way round). */
  kindMismatch: boolean;
}

/** The i-th file (in the order given) becomes the i-th scene, from `startIndex`. */
export function planRename(files: readonly SourceMedia[], scenes: readonly Scene[], startIndex = 0): RenameRow[] {
  return files.map((file, i) => {
    const scene = scenes[startIndex + i];
    if (!scene) return { file, sceneId: null, newName: null, kindMismatch: false };
    const extension = extensionOf(file.name);
    return {
      file,
      sceneId: scene.id,
      newName: `${formatTimecode(scene.id, scene.start, scene.end)}.${extension}`,
      kindMismatch: scene.mediaType !== file.kind,
    };
  });
}
