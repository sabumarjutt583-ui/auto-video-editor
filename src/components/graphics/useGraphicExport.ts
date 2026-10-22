import { useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { motionSize, withGraphic } from "../../lib/motion/request";
import { createFrameSource, exportGraphic, tauriExportApi } from "../../lib/graphics/export";
import type { GraphicSpec } from "../../lib/graphics/spec";
import { readEditor } from "../../lib/editor/model";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import { runJob, selectJob, useJobStore, type JobInfo } from "../../store/jobStore";
import type { AppError, MotionGraphic, Project, Scene } from "../../types";

export interface GraphicExportView {
  job: JobInfo | null;
  error: AppError | null;
  cancelled: boolean;
  /** Draws the graphic at the video's size, saves it as a transparent clip and puts it at the start of the scene. */
  add: (spec: GraphicSpec, scene: Scene) => Promise<void>;
}

/** Letters, digits, "-" and "_" only (it becomes a folder name). */
export function newGraphicId(now: number = Date.now(), random: number = Math.random()): string {
  return `g${now.toString(36)}${Math.floor(random * 1296).toString(36)}`;
}

/** Exports app-drawn graphics as background jobs and keeps them in the project. */
export function useGraphicExport(project: Project, dir: string | null): GraphicExportView {
  const job = useJobStore(selectJob(["graphic-export"]));
  const [error, setError] = useState<AppError | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const add = async (spec: GraphicSpec, scene: Scene) => {
    setError(null);
    setCancelled(false);
    const id = newGraphicId();
    const { width, height } = motionSize(project.settings.aspectRatio);
    const drawn: GraphicSpec = { ...spec, id };
    try {
      const clip = await runJob("graphic-export", "Drawing the graphic", (jobId) =>
        exportGraphic({ projectId: project.id, graphicId: id, spec: drawn, width, height, jobId, api: tauriExportApi, createSource: () => createFrameSource(drawn, width, height, dir ?? "") }),
      );
      const graphic: MotionGraphic = {
        id, sceneId: scene.id, start: scene.start, duration: drawn.duration, idea: "", framesDir: "", htmlPath: "", fps: 30,
        frames: clip.frames, width: clip.width, height: clip.height, enabled: true, kind: "spec", clipPath: clip.path, spec: drawn,
      };
      const data = readEditor(useProjectStore.getState().project ?? project);
      applyEdit({ editor: { ...data, motion: withGraphic(data.motion, graphic, null) } });
    } catch (e) {
      if (isCancelled(e)) setCancelled(true);
      else setError(toAppError(e, "The graphic could not be made."));
    }
  };

  return { job, error, cancelled, add };
}
