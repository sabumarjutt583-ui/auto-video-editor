import { useState } from "react";

import { isCancelled, toAppError } from "../../../lib/errors";
import {
  cleanOverrides, copyStart, fillPreset, makePreset, putGraphic, readPresets, removeGraphic, wordPoints,
  type ColorOverrides, type GraphicPreset, type TimeLimits,
} from "../../../lib/graphics/editing";
import { graphicWindow } from "../../../lib/graphics/director";
import type { Theme } from "../../../lib/graphics/render/theme";
import type { GraphicSpec } from "../../../lib/graphics/spec";
import { readEditor } from "../../../lib/editor/model";
import { applyEdit } from "../../../store/historyStore";
import { useGraphicSelection } from "../../../store/graphicSelectionStore";
import { useProjectStore } from "../../../store/projectStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { selectJob, useJobStore, type JobInfo } from "../../../store/jobStore";
import type { AppError, MotionGraphic, Project } from "../../../types";
import { drawGraphic } from "../exportClip";
import { newGraphicId } from "../useGraphicExport";

export interface GraphicEditing {
  job: JobInfo | null;
  error: AppError | null;
  presets: GraphicPreset[];
  /** Words and scene limits for dragging the edges of a graphic. */
  limitsFor: (g: MotionGraphic) => TimeLimits | null;
  /** Moves or resizes in time. The clip is drawn again only when the length changed. */
  retime: (id: string, to: { start: number; duration: number }) => Promise<void>;
  /** Draws the graphic again with a changed spec (texts, icon, position, animation). */
  commitSpec: (id: string, spec: GraphicSpec) => Promise<void>;
  setColors: (id: string, colors: ColorOverrides) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  remove: (id: string) => void;
  savePreset: (id: string, name: string) => boolean;
  deletePreset: (id: string) => void;
  /** Puts a preset on a scene with the given texts. Returns false when the scene is too short. */
  insertPreset: (preset: GraphicPreset, sceneId: string, texts: string[]) => Promise<boolean>;
}

/** Edits of single graphics: every change goes through the project history, so undo and redo work. */
export function useGraphicEditing(project: Project, dir: string | null, theme: Theme): GraphicEditing {
  const job = useJobStore(selectJob(["graphic-export"]));
  const [error, setError] = useState<AppError | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const presets = readPresets(settings?.graphicPresets ?? []);

  const live = () => useProjectStore.getState().project ?? project;
  const entry = (id: string): MotionGraphic | undefined => readEditor(live()).motion.find((g) => g.id === id);
  const write = (update: (list: MotionGraphic[]) => MotionGraphic[]) => {
    const data = readEditor(live());
    applyEdit({ editor: { ...data, motion: update(data.motion) } });
  };
  const guard = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    try { await work(); } catch (e) { if (!isCancelled(e)) setError(toAppError(e, "The graphic could not be changed.")); }
  };

  const limitsFor = (g: MotionGraphic): TimeLimits | null => {
    const scene = live().scenes.find((s) => s.id === g.sceneId);
    return scene ? { scene: { start: scene.start, end: scene.end }, points: wordPoints(live().words, scene) } : null;
  };

  /** Draws `spec` as a new clip (new id: a clip file is never overwritten) and swaps it in for `old`. */
  const redraw = async (old: MotionGraphic, patch: { start?: number; duration?: number; spec?: GraphicSpec; colors?: ColorOverrides }, stage: string) => {
    const colors = patch.colors ?? old.colors;
    const made = await drawGraphic(live(), dir, theme, {
      id: newGraphicId(), sceneId: old.sceneId, start: patch.start ?? old.start, duration: patch.duration ?? old.duration,
      spec: patch.spec ?? (old.spec as GraphicSpec), ...(old.origin ? { origin: old.origin } : {}), ...(colors ? { colors } : {}),
    }, stage);
    write((list) => putGraphic(removeGraphic(list, old.id), made));
    // The new clip has a new id: keep it selected.
    if (useGraphicSelection.getState().selectedId === old.id) useGraphicSelection.getState().select(made.id);
  };

  return {
    job, error, presets, limitsFor,
    retime: (id, to) => guard(async () => {
      const old = entry(id);
      if (!old) return;
      if (Math.abs(to.duration - old.duration) < 0.005) write((list) => list.map((g) => (g.id === id ? { ...g, start: to.start } : g)));
      else await redraw(old, to, "Drawing the graphic with its new length");
    }),
    commitSpec: (id, spec) => guard(async () => { const old = entry(id); if (old) await redraw(old, { spec }, "Drawing the changed graphic"); }),
    setColors: (id, colors) => guard(async () => { const old = entry(id); if (old) await redraw(old, { colors: cleanOverrides(colors) }, "Drawing the graphic with its new colours"); }),
    duplicate: (id) => guard(async () => {
      const old = entry(id);
      const scene = old ? live().scenes.find((s) => s.id === old.sceneId) : undefined;
      if (!old || !scene || !old.spec) return;
      const made = await drawGraphic(live(), dir, theme, {
        id: newGraphicId(), sceneId: old.sceneId, start: copyStart(old, scene), duration: old.duration, spec: old.spec as GraphicSpec,
        ...(old.colors ? { colors: old.colors } : {}),
      }, "Drawing the copy");
      write((list) => putGraphic(list, made));
      useGraphicSelection.getState().select(made.id);
    }),
    remove: (id) => write((list) => removeGraphic(list, id)),
    savePreset: (id, name) => {
      const old = entry(id);
      if (!old?.spec) return false;
      const made = makePreset(name, old.spec as GraphicSpec, presets.map((p) => p.id));
      if (!made) return false;
      updateSettings({ graphicPresets: [...presets, made] });
      return true;
    },
    deletePreset: (id) => updateSettings({ graphicPresets: presets.filter((p) => p.id !== id) }),
    insertPreset: async (preset, sceneId, texts) => {
      const scene = live().scenes.find((s) => s.id === sceneId);
      const spec = fillPreset(preset, texts);
      if (!scene || !spec) return false;
      const window = graphicWindow(scene, scene.start, scene.start, spec.duration);
      if (!window) return false;
      await guard(async () => {
        const made = await drawGraphic(live(), dir, theme, { id: newGraphicId(), sceneId, start: window.start, duration: window.duration, spec }, "Drawing the graphic");
        write((list) => putGraphic(list, made));
      });
      return true;
    },
  };
}
