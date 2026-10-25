/** What the Channels dashboards show, worked out from the project list and the run that is going on (pure). */

import type { ProjectSummary } from "../../types/project.ts";
import { STAGE_IDS, type StageId } from "./stages.ts";

export interface ActiveRun {
  projectId: string | null;
  running: boolean;
  /** The step that waits for "Continue". */
  waiting: StageId | null;
  /** True when the last run of this project ended with an error. */
  failed: boolean;
}

export type VideoState = "running" | "waiting" | "failed" | "stopped" | "finished" | "empty";

export interface StageProgress {
  id: StageId;
  done: boolean;
  /** "12 of 40" for steps with a count, else "". */
  detail: string;
}

/** Every step of "Make video" for one project: finished or not, with a count where there is one. */
export function stageProgress(project: ProjectSummary): StageProgress[] {
  const promptsDone = project.sceneCount > 0 && project.promptsWritten >= project.sceneCount;
  const picturesDone = project.pictureScenes > 0 && project.pictures >= project.pictureScenes;
  const done: Record<StageId, boolean> = {
    voice: project.voiceLocked,
    timing: project.hasWords,
    scenes: project.sceneCount > 0,
    cast: project.bibleLocked,
    prompts: promptsDone,
    images: picturesDone,
    audio: project.audioMixed,
    render: project.rendered,
  };
  const detail: Record<StageId, string> = {
    voice: "",
    timing: "",
    scenes: project.sceneCount > 0 ? `${project.sceneCount} scenes` : "",
    cast: "",
    prompts: project.sceneCount > 0 ? `${project.promptsWritten} of ${project.sceneCount}` : "",
    images: project.pictureScenes > 0 ? `${project.pictures} of ${project.pictureScenes}` : "",
    audio: "",
    render: "",
  };
  return STAGE_IDS.map((id) => ({ id, done: done[id], detail: detail[id] }));
}

/** The share of finished steps, 0 to 100. */
export function percentOf(project: ProjectSummary): number {
  const rows = stageProgress(project);
  return Math.round((rows.filter((row) => row.done).length / rows.length) * 100);
}

/** The step the video is at: the first one that is not finished (null when everything is). */
export function currentStage(project: ProjectSummary): StageId | null {
  return stageProgress(project).find((row) => !row.done)?.id ?? null;
}

export function videoState(project: ProjectSummary, active: ActiveRun): VideoState {
  if (active.projectId === project.id) {
    if (active.waiting !== null) return "waiting";
    if (active.running) return "running";
    if (active.failed) return "failed";
  }
  if (project.rendered) return "finished";
  const started = project.voiceLocked || project.hasWords || project.sceneCount > 0;
  return started ? "stopped" : "empty";
}

export interface Counts {
  total: number;
  running: number;
  waiting: number;
  failed: number;
  stopped: number;
  finished: number;
}

export function countVideos(projects: readonly ProjectSummary[], active: ActiveRun): Counts {
  const counts: Counts = { total: 0, running: 0, waiting: 0, failed: 0, stopped: 0, finished: 0 };
  for (const project of projects) {
    const state = videoState(project, active);
    if (state === "empty") continue;
    counts.total += 1;
    counts[state] += 1;
  }
  return counts;
}

/** The videos of one channel, newest first. */
export function videosOf(projects: readonly ProjectSummary[], channelId: string): ProjectSummary[] {
  return projects.filter((project) => project.channelId === channelId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Videos that need a look: running, waiting for the person, or failed. Newest first. */
export function needAttention(projects: readonly ProjectSummary[], active: ActiveRun): ProjectSummary[] {
  return projects
    .filter((project) => {
      const state = videoState(project, active);
      return state === "running" || state === "waiting" || state === "failed";
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The latest finished videos, newest first. */
export function recentlyFinished(projects: readonly ProjectSummary[], limit = 5): ProjectSummary[] {
  return projects
    .filter((project) => project.rendered)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
