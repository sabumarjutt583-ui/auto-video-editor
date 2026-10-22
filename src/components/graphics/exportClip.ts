import { cacheable, cacheKey } from "../../lib/graphics/cache";
import { restoreCached, storeCached } from "../../lib/graphics/cache/api";
import { themeWith, type ColorOverrides } from "../../lib/graphics/editing";
import { createFrameSource, exportGraphic, fontsFor, tauriExportApi, type GraphicClip } from "../../lib/graphics/export";
import type { Theme } from "../../lib/graphics/render/theme";
import type { GraphicSpec } from "../../lib/graphics/spec";
import { readEditor } from "../../lib/editor/model";
import { motionSize } from "../../lib/motion/request";
import { runJob } from "../../store/jobStore";
import type { MotionGraphic, Project } from "../../types";

export { readEditor };

/** The key of the graphic's picture in the clip cache, or null when it cannot be cached (or the key cannot be made). */
async function keyOf(drawn: GraphicSpec, theme: Theme, width: number, height: number): Promise<string | null> {
  if (!cacheable(drawn)) return null;
  try {
    return await cacheKey({ spec: drawn, theme, fonts: fontsFor(drawn, theme).flatMap((f) => [f.regular, f.bold]), width, height });
  } catch {
    return null;
  }
}

/**
 * Draws a spec at the video's size into a transparent clip of the project and returns the finished graphic entry.
 * The same picture drawn before (same graphic, brand kit, fonts, size) is copied from the cache instead of drawn again.
 */
export async function drawGraphic(
  project: Project, dir: string | null, theme: Theme,
  made: { id: string; sceneId: string; start: number; duration: number; spec: GraphicSpec; origin?: "director"; colors?: ColorOverrides }, stage: string,
): Promise<MotionGraphic> {
  const { width, height } = motionSize(project.settings.aspectRatio);
  const drawn: GraphicSpec = { ...made.spec, id: made.id, duration: made.duration };
  const shownTheme = themeWith(theme, made.colors);
  const key = await keyOf(drawn, shownTheme, width, height);
  let clip: GraphicClip | null = null;
  if (key) clip = await restoreCached(project.id, made.id, key).catch(() => null);
  if (!clip) {
    clip = await runJob("graphic-export", stage, (jobId) =>
      exportGraphic({ projectId: project.id, graphicId: made.id, spec: drawn, width, height, jobId, api: tauriExportApi, createSource: () => createFrameSource(drawn, width, height, dir ?? "", shownTheme) }),
    );
    // A cache that cannot be written must never stop the work.
    if (key) await storeCached(project.id, made.id, key, clip).catch(() => undefined);
  }
  return {
    id: made.id, sceneId: made.sceneId, start: made.start, duration: made.duration, idea: "", framesDir: "", htmlPath: "", fps: 30,
    frames: clip.frames, width: clip.width, height: clip.height, enabled: true, kind: "spec", clipPath: clip.path, spec: drawn,
    ...(made.origin ? { origin: made.origin } : {}),
    ...(made.colors && Object.keys(made.colors).length > 0 ? { colors: made.colors } : {}),
  };
}
