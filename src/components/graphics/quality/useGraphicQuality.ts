import { useCallback, useState } from "react";

import { fontsDir } from "../../../lib/captions/api";
import { FONTS } from "../../../lib/captions/fonts";
import { isCancelled, toAppError } from "../../../lib/errors";
import { fontBytes, loadImages } from "../../../lib/graphics/export/frameSource";
import { mapDataOfSpec } from "../../../lib/graphics/geo/mapData";
import { ensureIcons, iconRefsOf } from "../../../lib/graphics/library/icons";
import type { Box } from "../../../lib/graphics/placement";
import { captionZone, safeArea } from "../../../lib/graphics/placement";
import { notesOf } from "./notes";
import { checkGraphics, glyphChecker, type GraphicItem, type QualityEnv, type QualityReport } from "../../../lib/graphics/quality";
import type { BrandKit } from "../../../lib/graphics/brand";
import { loadGraphicFonts, previewContext } from "../../../lib/graphics/render/browser";
import type { RenderContext } from "../../../lib/graphics/render/context";
import type { Theme } from "../../../lib/graphics/render/theme";
import { readEditor } from "../../../lib/editor/model";
import { motionSize } from "../../../lib/motion/request";
import { applyEdit } from "../../../store/historyStore";
import { selectJob, useJobStore, type JobInfo } from "../../../store/jobStore";
import { useProjectStore } from "../../../store/projectStore";
import type { AppError, Project } from "../../../types";
import { findSubjects } from "../director/subjectFinder";
import { drawGraphic } from "../exportClip";
import { newGraphicId } from "../useGraphicExport";

export interface QualityView {
  report: QualityReport | null;
  checking: boolean;
  job: JobInfo | null;
  error: AppError | null;
  /** Looks at every automatic and hand-made graphic of the project. */
  check: () => Promise<QualityReport | null>;
  /** Repairs what can be repaired safely, draws the changed graphics again and checks once more. */
  fix: () => Promise<void>;
}


/** The quality checks of docs/MOTION_GRAPHICS.md phase 9, run on the graphics of a project with its real fonts, pictures and captions. */
export function useGraphicQuality(project: Project, dir: string | null, kit: BrandKit, theme: Theme): QualityView {
  const job = useJobStore(selectJob(["placement", "graphic-export"]));
  const [report, setReport] = useState<QualityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const build = useCallback(async (): Promise<{ items: GraphicItem[]; env: QualityEnv } | null> => {
    const live = useProjectStore.getState().project ?? project;
    const editor = readEditor(live);
    const specs = editor.motion.filter((g) => g.kind === "spec" && g.spec && g.enabled);
    if (specs.length === 0) return null;
    const items: GraphicItem[] = specs.map((g) => ({ id: g.id, sceneId: g.sceneId, start: g.start, duration: g.duration, spec: g.spec as GraphicItem["spec"] }));
    const { width, height } = motionSize(live.settings.aspectRatio);

    await loadGraphicFonts();
    const checkers = new Map<string, (cp: number) => boolean>();
    try {
      const fonts = await fontsDir();
      for (const font of FONTS) checkers.set(font.family, glyphChecker(new Uint8Array(await fontBytes(fonts, font.regular))));
    } catch {
      // Unknown fonts are not counted as missing glyphs.
    }
    const contexts = new Map<string, RenderContext>();
    for (const item of items) {
      await ensureIcons(iconRefsOf(item.spec));
      const images = new Map(Object.entries(await loadImages(item.spec, dir ?? "")));
      contexts.set(item.id, previewContext(width, height, images, await mapDataOfSpec(item.spec), theme));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This computer cannot draw the graphic.");

    const finder = await findSubjects(live, editor, dir ?? "", items.map((i) => i.sceneId), false);
    const env: QualityEnv = {
      theme,
      scene: (id) => { const s = live.scenes.find((x) => x.id === id); return s ? { start: s.start, end: s.end } : undefined; },
      caption: captionZone(editor.captions.style, live.settings.aspectRatio),
      safe: safeArea(kit.safeMargins),
      subjectsFor: (item) => finder.subjectsFor(item),
      pictureColor: (item, box: Box) => finder.colorUnder(item.sceneId, box),
      notes: (spec) => notesOf(spec, ctx, contexts.get(spec.id) ?? previewContext(width, height, new Map(), {}, theme)),
      hasGlyph: (family, cp) => checkers.get(family)?.(cp) ?? null,
    };
    return { items, env };
  }, [project, dir, kit, theme]);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const made = await build();
      const next = made ? checkGraphics(made.items, made.env) : { issues: [], changed: [] };
      setReport(next);
      return next;
    } catch (e) {
      setError(toAppError(e, "The graphics could not be checked."));
      return null;
    } finally {
      setChecking(false);
    }
  }, [build]);

  const fix = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const made = await build();
      if (!made) { setReport({ issues: [], changed: [] }); return; }
      const result = checkGraphics(made.items, made.env, { fix: true });
      const redrawn = [];
      for (const [i, g] of result.changed.entries()) {
        const old = readEditor(useProjectStore.getState().project ?? project).motion.find((m) => m.id === g.id);
        redrawn.push(await drawGraphic(project, dir, theme, { id: newGraphicId(), sceneId: g.sceneId, start: g.start, duration: g.duration, spec: g.spec, ...(old?.origin ? { origin: old.origin } : {}) }, `Drawing the repaired graphic ${i + 1} of ${result.changed.length}`));
      }
      if (redrawn.length > 0) {
        const data = readEditor(useProjectStore.getState().project ?? project);
        const replaced = new Set(result.changed.map((g) => g.id));
        applyEdit({ editor: { ...data, motion: [...data.motion.filter((m) => !replaced.has(m.id)), ...redrawn].sort((a, b) => a.start - b.start) } });
      }
      setReport({ issues: result.issues, changed: [] });
    } catch (e) {
      if (!isCancelled(e)) setError(toAppError(e, "The graphics could not be repaired."));
    } finally {
      setChecking(false);
    }
  }, [build, project, dir, theme]);

  return { report, checking, job, error, check, fix };
}
