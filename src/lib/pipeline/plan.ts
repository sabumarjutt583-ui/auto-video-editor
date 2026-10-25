/** Which steps of "Make video" are already finished in a project (so a run can continue where it stopped). */

import type { Project } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";
import type { StageId } from "./stages.ts";

/** Scenes that should get a picture: images with a prompt. */
export function pictureScenes(project: Pick<Project, "scenes">) {
  return project.scenes.filter((scene) => scene.mediaType === "image" && scene.prompt.trim() !== "");
}

export function stageDone(project: Project, stage: StageId): boolean {
  switch (stage) {
    case "voice":
      return project.voiceLocked && project.voicePath !== null && project.voiceDuration > 0;
    case "timing":
      return project.words.length > 0;
    case "scenes":
      return project.scenes.length > 0;
    case "cast":
      return project.bibleLocked;
    case "prompts":
      return project.scenes.length > 0 && project.scenes.every((scene) => scene.prompt.trim() !== "");
    case "images": {
      const needed = pictureScenes(project);
      return needed.length > 0 && needed.every((scene) => (project.mediaMap[scene.id] ?? "") !== "");
    }
    case "audio":
      return readEditor(project).audio.mix !== null;
    case "render":
      return project.renderedAt !== null;
  }
}

/** Scene ids that still need a picture. */
export function scenesWithoutPicture(project: Project): string[] {
  return pictureScenes(project)
    .filter((scene) => (project.mediaMap[scene.id] ?? "") === "")
    .map((scene) => scene.id);
}
