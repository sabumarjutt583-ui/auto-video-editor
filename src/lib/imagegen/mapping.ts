import type { NewImageJob, PictureAspect } from "../../types/imagegen.ts";
import type { Scene } from "../../types/project.ts";
import type { AspectRatio } from "../../types/settings.ts";
import { formatTimecode } from "../scenes/timecode.ts";

/** Why a scene gets no picture from the generator. */
export interface SkippedScene {
  sceneId: string;
  reason: "no_prompt" | "video";
}

export interface BuiltJobs {
  jobs: NewImageJob[];
  skipped: SkippedScene[];
}

/** The project's shape as the generator's aspect: 16:9, 1:1 or 9:16. */
export function pictureAspect(ratio: AspectRatio): PictureAspect {
  return ratio;
}

/** `S01_000.0-005.1.png`: the name the Auto Editor matches to the scene. */
export function pictureFileName(scene: Pick<Scene, "id" | "start" | "end">): string {
  return `${formatTimecode(scene.id, scene.start, scene.end)}.png`;
}

/**
 * One job per scene (or per chosen scene): the scene's final prompt from the Prompt Generator, the timecode
 * file name and the project's aspect ratio. Scenes without a prompt, and scenes that want a video clip, are left out.
 */
export function buildJobs(scenes: readonly Scene[], ratio: AspectRatio, only?: readonly string[]): BuiltJobs {
  const wanted = only ? new Set(only) : null;
  const jobs: NewImageJob[] = [];
  const skipped: SkippedScene[] = [];
  for (const scene of [...scenes].sort((a, b) => a.index - b.index)) {
    if (wanted && !wanted.has(scene.id)) continue;
    if (scene.mediaType === "video") {
      skipped.push({ sceneId: scene.id, reason: "video" });
      continue;
    }
    const prompt = scene.prompt.trim();
    if (prompt === "") {
      skipped.push({ sceneId: scene.id, reason: "no_prompt" });
      continue;
    }
    jobs.push({ sceneId: scene.id, fileName: pictureFileName(scene), prompt, aspect: pictureAspect(ratio) });
  }
  return { jobs, skipped };
}
