import { useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { motionGenerate } from "../../lib/motion/api";
import { buildMotionRequest, newMotionId, toGraphic, withGraphic } from "../../lib/motion/request";
import { readEditor } from "../../lib/editor/model";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import { runJob, selectJob, useJobStore, type JobInfo } from "../../store/jobStore";
import type { AppError, MotionGraphic, Project, Scene } from "../../types";

export interface MotionView {
  job: JobInfo | null;
  error: AppError | null;
  cancelled: boolean;
  /** Makes (or, with `replaceId`, remakes) a graphic for a scene. */
  make: (scene: Scene, idea: string, replaceId: string | null) => Promise<void>;
  change: (id: string, patch: Partial<Pick<MotionGraphic, "start" | "enabled">>) => void;
  remove: (id: string) => void;
}

/** Asks the AI for motion graphics and keeps them in the project. */
export function useMotion(project: Project): MotionView {
  const job = useJobStore(selectJob(["motion"]));
  const [error, setError] = useState<AppError | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const save = (update: (list: MotionGraphic[]) => MotionGraphic[]) => {
    const data = readEditor(useProjectStore.getState().project ?? project);
    applyEdit({ editor: { ...data, motion: update(data.motion) } });
  };

  const make = async (scene: Scene, idea: string, replaceId: string | null) => {
    setError(null);
    setCancelled(false);
    const request = buildMotionRequest(scene, newMotionId(), project.language, project.settings.aspectRatio, (project.styleId ?? "").replace(/_/g, " "), idea);
    try {
      const result = await runJob("motion", "Asking Gemini for a motion graphic", (id) => motionGenerate(project.id, request, id));
      save((list) => withGraphic(list, toGraphic(result, scene, idea), replaceId));
    } catch (e) {
      if (isCancelled(e)) setCancelled(true);
      else setError(toAppError(e, "The motion graphic could not be made."));
    }
  };

  return {
    job,
    error,
    cancelled,
    make,
    change: (id, patch) => save((list) => list.map((g) => (g.id === id ? { ...g, ...patch } : g))),
    remove: (id) => save((list) => list.filter((g) => g.id !== id)),
  };
}
