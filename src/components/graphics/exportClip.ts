import { createFrameSource, exportGraphic, tauriExportApi } from "../../lib/graphics/export";
import { readEditor } from "../../lib/editor/model";
import { motionSize } from "../../lib/motion/request";
import { themeWith, type ColorOverrides } from "../../lib/graphics/editing";
import type { Theme } from "../../lib/graphics/render/theme";
import type { GraphicSpec } from "../../lib/graphics/spec";
import { runJob } from "../../store/jobStore";
import type { MotionGraphic, Project } from "../../types";

export { readEditor };

/** Draws a spec at the video's size into a transparent clip of the project (one background job) and returns the finished graphic entry. */
export async function drawGraphic(
  project: Project, dir: string | null, theme: Theme,
  made: { id: string; sceneId: string; start: number; duration: number; spec: GraphicSpec; origin?: "director"; colors?: ColorOverrides }, stage: string,
): Promise<MotionGraphic> {
  const { width, height } = motionSize(project.settings.aspectRatio);
  const drawn: GraphicSpec = { ...made.spec, id: made.id, duration: made.duration };
  const clip = await runJob("graphic-export", stage, (jobId) =>
    exportGraphic({ projectId: project.id, graphicId: made.id, spec: drawn, width, height, jobId, api: tauriExportApi, createSource: () => createFrameSource(drawn, width, height, dir ?? "", themeWith(theme, made.colors)) }),
  );
  return {
    id: made.id, sceneId: made.sceneId, start: made.start, duration: made.duration, idea: "", framesDir: "", htmlPath: "", fps: 30,
    frames: clip.frames, width: clip.width, height: clip.height, enabled: true, kind: "spec", clipPath: clip.path, spec: drawn,
    ...(made.origin ? { origin: made.origin } : {}),
    ...(made.colors && Object.keys(made.colors).length > 0 ? { colors: made.colors } : {}),
  };
}
