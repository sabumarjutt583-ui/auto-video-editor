/** Scene videos and motion graphics inside the "Make video" plan (Phase 4). Pure plan only: this
file makes no video, draws no graphic, and calls no engine — it only says which steps the pipeline
would have, and which of them are done.

What exists today, and what this does not change: the profile's look is locked to pictures
(`outputType: "image"` in `profile.ts`, "Phase 1 makes pictures only"), the pictures step makes one
picture per image scene, and scene videos live only on the Image Generator page (`useVideoMaker`,
one video per ready Google account). So this plan covers two things the pipeline did not cover:
scenes whose media type is already "video" (they were never in `pictureScenes`), and the project's
motion graphics (spec graphics drawn by the app, legacy HTML graphics kept as they are). The Rust
director plan from Phase 3 (`src-tauri/src/graphics/director.rs`) is still not connected to a Tauri
command, so this plan does not call it either — it only lists which spec graphics are ready to be
planned (they have a clip) and which are missing one. A full end-to-end scene-video or
motion-director render inside "Make video" is still later work, not claimed here. */

import type { MotionGraphic } from "../../types/editor.ts";
import type { Project } from "../../types/project.ts";
import { formatTimecode } from "../scenes/timecode.ts";

export type SceneVideoState = "done" | "missing" | "queued" | "failed";

/** One video step in the pipeline plan. */
export interface SceneVideoStep {
  sceneId: string;
  /** `S01_000.0-005.1.mp4`, the same name the video maker uses. */
  fileName: string;
  /** The words the video would be made from (scene prompt, plus motion when it has one). */
  prompt: string;
  state: SceneVideoState;
  /** The video file already placed for this scene, or null. */
  mediaPath: string | null;
}

function isVideoPath(path: string | undefined): boolean {
  return path !== undefined && /\.(mp4|mov|webm)$/i.test(path);
}

/** Video steps, in scene order. Scenes with no prompt are left out (there is nothing to make a video from).
A scene counts as done only when a video file is already placed for it; otherwise its state comes
from `states` when the caller knows it, else "missing". */
export function sceneVideoSteps(project: Pick<Project, "scenes" | "mediaMap">, states: Readonly<Record<string, SceneVideoState>> = {}): SceneVideoStep[] {
  return [...project.scenes]
    .sort((a, b) => a.index - b.index)
    .filter((scene) => scene.mediaType === "video")
    .map((scene) => {
      const prompt = [scene.prompt.trim(), scene.motionPrompt.trim()].filter((part) => part !== "").join(" ");
      const placed = project.mediaMap[scene.id] ?? null;
      return { sceneId: scene.id, fileName: `${formatTimecode(scene.id, scene.start, scene.end)}.mp4`, prompt, state: isVideoPath(placed ?? undefined) ? ("done" as const) : (states[scene.id] ?? "missing"), mediaPath: isVideoPath(placed ?? undefined) ? placed : null };
    })
    .filter((step) => step.prompt !== "");
}

/** Video scenes that still have no video file. */
export function videoScenesMissing(project: Pick<Project, "scenes" | "mediaMap">): string[] {
  return sceneVideoSteps(project).filter((step) => step.state !== "done").map((step) => step.sceneId);
}

export type MotionPlanState = "ready" | "missing-clip" | "legacy";

/** One motion graphic in the pipeline plan. */
export interface MotionPlanStep {
  graphicId: string;
  sceneId: string;
  state: MotionPlanState;
  /** True when the graphic is a spec graphic (drawn by the app), false for legacy HTML graphics. */
  hasSpec: boolean;
  /** The transparent clip, when one exists. */
  clipPath: string | null;
}

/** Spec graphics with a clip are ready to be planned; spec graphics without a clip are missing one;
legacy graphics are kept but are not part of the director plan. */
export function motionPlanSteps(motion: readonly MotionGraphic[]): MotionPlanStep[] {
  return motion.map((graphic) => {
    const hasSpec = graphic.kind === "spec";
    return {
      graphicId: graphic.id,
      sceneId: graphic.sceneId,
      state: !hasSpec ? ("legacy" as const) : graphic.clipPath ? ("ready" as const) : ("missing-clip" as const),
      hasSpec,
      clipPath: graphic.clipPath ?? null,
    };
  });
}

/** The pipeline extras in one place: video steps, motion steps, and their counts. */
export function pipelineExtras(project: Pick<Project, "scenes" | "mediaMap">, motion: readonly MotionGraphic[], videoStates: Readonly<Record<string, SceneVideoState>> = {}) {
  const videoSteps = sceneVideoSteps(project, videoStates);
  const motionSteps = motionPlanSteps(motion);
  return {
    videoSteps,
    motionSteps,
    videoDone: videoSteps.filter((step) => step.state === "done").length,
    videoMissing: videoSteps.filter((step) => step.state !== "done").length,
    motionReady: motionSteps.filter((step) => step.state === "ready").length,
    motionMissingClip: motionSteps.filter((step) => step.state === "missing-clip").length,
  };
}
