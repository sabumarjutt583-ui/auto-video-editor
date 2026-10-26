/** The single-failed-scenes list for "Make video" (Phase 4): only the scenes that failed, with a
reason and a retry state, in scene order. Nothing here runs anything or touches a Google account.

Why a separate list: the pictures step today throws one lump error ("3 of 40 pictures are
missing") and the run screen shows only the failed step, not which scenes. This file turns the
per-scene results — or, when only the project is known, the scenes still without a picture — into
the list a person needs to fix and retry. Retrying itself is the existing resume path (finished
steps are skipped, missing scenes are sent again). */

import type { Project } from "../../types/project.ts";
import { pictureScenes } from "./plan.ts";

export type SceneFailureKind = "missing" | "failed";

/** One scene's result, as reported by the step that made it. */
export interface SceneResult {
  id: string;
  status: "done" | "failed" | "missing" | "waiting";
  /** The step's own error words, when it has any. */
  error?: string;
  /** How many times this scene has already been tried. */
  retries?: number;
}

export interface FailedScene {
  id: string;
  kind: SceneFailureKind;
  /** Plain words, never empty. */
  reason: string;
  retries: number;
  /** False once the scene has been tried enough times: it needs a look, not another blind retry. */
  retryable: boolean;
}

export const MAX_SCENE_RETRIES = 3;

/** Only the failed and missing scenes, in the order they were given. Done and waiting scenes are left out. */
export function failedScenes(results: readonly SceneResult[]): FailedScene[] {
  return results
    .filter((result) => result.status === "failed" || result.status === "missing")
    .map((result) => {
      const retries = Math.max(0, result.retries ?? 0);
      const errorText = result.error?.trim() ?? "";
      return {
        id: result.id,
        kind: result.status === "missing" ? ("missing" as const) : ("failed" as const),
        reason: errorText !== "" ? errorText : result.status === "missing" ? "Picture is missing." : "Making this scene failed.",
        retries,
        retryable: retries < MAX_SCENE_RETRIES,
      };
    });
}

/** The same list worked out from a project alone: every picture scene that still has no file.
`jobErrors` is the picture engine's own error per scene id, when the caller has it; without it the
reason is the plain "Picture is missing." line. */
export function failedScenesFromProject(project: Pick<Project, "scenes" | "mediaMap">, jobErrors: Readonly<Record<string, string>> = {}): FailedScene[] {
  return failedScenes(
    pictureScenes(project).map((scene) => ({
      id: scene.id,
      status: (project.mediaMap[scene.id] ?? "") !== "" ? ("done" as const) : ("missing" as const),
      error: jobErrors[scene.id],
    })),
  );
}

/** Just the ids, in scene order — the shape a retry button needs. */
export function failedSceneIds(results: readonly SceneResult[]): string[] {
  return failedScenes(results).map((scene) => scene.id);
}

/** The failed scenes that may simply be tried again. */
export function retryableFailedScenes(results: readonly SceneResult[]): FailedScene[] {
  return failedScenes(results).filter((scene) => scene.retryable);
}
