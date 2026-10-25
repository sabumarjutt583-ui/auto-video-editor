/** What every real step of "Make video" gets, and the two helpers they share. */

import { useProjectStore } from "../../../store/projectStore.ts";
import type { Project, ProjectPatch } from "../../../types/project.ts";
import type { ChannelProfile } from "../profile.ts";

export interface StageContext {
  projectId: string;
  profile: ChannelProfile;
  /** The person's own voice file (full path), or null to make the voice from the script. */
  voiceFile: string | null;
  /** Shows a short line under the step on the run screen. */
  say: (text: string) => void;
  /** True once the person pressed Cancel. */
  cancelled: () => boolean;
  /** Called with the finished video's details when the render step ends. */
  finished: (result: { path: string; copyPath: string | null; seconds: number; sizeBytes: number }) => void;
}

/** The open project, read fresh. Throws when another project was opened meanwhile. */
export function openProjectOf(ctx: Pick<StageContext, "projectId">): Project {
  const project = useProjectStore.getState().project;
  if (!project || project.id !== ctx.projectId) throw new Error("The project was closed while the video was being made.");
  return project;
}

export function patchProject(ctx: Pick<StageContext, "projectId">, patch: ProjectPatch): void {
  openProjectOf(ctx);
  useProjectStore.getState().update(patch);
}
