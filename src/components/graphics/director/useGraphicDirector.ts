import { useState } from "react";

import { generateText } from "../../../lib/ai";
import { isCancelled, toAppError } from "../../../lib/errors";
import { readEditor } from "../../../lib/editor/model";
import { buildPlaceIndex, detectTriggers, directGraphics, fallbackFor, type DirectorScene, type Placed, type TimedWord } from "../../../lib/graphics/director";
import { kitSummary, type BrandKit, type Density } from "../../../lib/graphics/brand";
import { presetExamples, readPresets } from "../../../lib/graphics/editing";
import { captionZone, placeAll, safeArea } from "../../../lib/graphics/placement";
import { loadCities } from "../../../lib/graphics/geo/cities";
import { searchIcons } from "../../../lib/graphics/library/icons";
import type { Theme } from "../../../lib/graphics/render/theme";
import { LANGUAGES } from "../../../lib/languages";
import { applyEdit } from "../../../store/historyStore";
import { runJob, selectJob, useJobStore, type JobInfo } from "../../../store/jobStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useProjectStore } from "../../../store/projectStore";
import { useStyleStore } from "../../../store/styleStore";
import type { AppError, MotionGraphic, Project } from "../../../types";
import { drawGraphic } from "../exportClip";
import { newGraphicId } from "../useGraphicExport";
import { findSubjects } from "./subjectFinder";

export interface DirectorView {
  job: JobInfo | null;
  error: AppError | null;
  cancelled: boolean;
  /** What the last run did, in plain words. */
  summary: string | null;
  /** What placement did to graphics that were in the way (moved, made smaller, replaced, left out). */
  notes: string[];
  density: Density;
  setDensity: (d: Density) => void;
  /** Plans and draws graphics for the whole project (or only for these scenes). */
  generate: (only?: ReadonlySet<string>) => Promise<void>;
}

/** The scenes of the project as the director sees them: timed words, English description, found triggers. */
export async function directorScenes(project: Project): Promise<DirectorScene[]> {
  const places = buildPlaceIndex(await loadCities());
  const out: DirectorScene[] = [];
  for (const scene of project.scenes) {
    if (!(scene.end > scene.start)) continue;
    const words: TimedWord[] = project.words.slice(scene.firstWord, scene.lastWord + 1).map((w) => ({ text: w.text, start: w.start, end: w.end }));
    const base = { id: scene.id, start: scene.start, end: scene.end, text: scene.text, words };
    out.push({ ...base, index: scene.index, description: scene.description, triggers: detectTriggers(base, places) });
  }
  return out;
}

async function iconsFor(scene: DirectorScene): Promise<string[]> {
  const query = `${scene.description} ${scene.triggers.map((t) => t.kind).join(" ")}`;
  return (await searchIcons(query, 30)).map((h) => `${h.set}:${h.name}`);
}

/** The AI graphics director: finds the moments, asks the AI, checks the answers, draws every graphic and puts it in the project. */
export function useGraphicDirector(project: Project, dir: string | null, kit: BrandKit, theme: Theme): DirectorView {
  const job = useJobStore(selectJob(["graphics-plan", "placement", "graphic-export"]));
  const styles = useStyleStore((s) => s.styles);
  const presetsRaw = useSettingsStore((s) => s.settings?.graphicPresets) ?? [];
  const [density, setDensity] = useState<Density>(kit.density);
  const [error, setError] = useState<AppError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const generate = async (only?: ReadonlySet<string>) => {
    setError(null);
    setCancelled(false);
    setSummary(null);
    setNotes([]);
    const made: MotionGraphic[] = [];
    const processed = new Set<string>();
    let note = "";
    let complete = false;
    try {
      const scenes = await directorScenes(project);
      const current = readEditor(useProjectStore.getState().project ?? project).motion;
      const kept = current.filter((g) => g.origin === "director" && (only ? !only.has(g.sceneId) : false));
      const earlier = kept.flatMap((g) => (g.spec ? [{ id: g.sceneId, type: g.spec.layers[0]?.type ?? "text" }] : []));
      const language = LANGUAGES.find((l) => l.code === project.language)?.name ?? "the narration language";
      const styleName = styles.find((s) => s.id === project.styleId)?.name ?? "the project's style";
      const result = await runJob("graphics-plan", "Choosing where graphics help", (jobId) =>
        directGraphics({
          scenes, settings: { density, language, styleName, kitSummary: kitSummary(kit) }, ...(only ? { only } : {}), earlier,
          call: async (system, prompt) => (await generateText(prompt, system, true, jobId)).text,
          icons: iconsFor,
          examples: presetExamples(readPresets(presetsRaw)),
        }),
      );
      // Placement: keep every graphic off the subject, the captions and the margins.
      const data = readEditor(useProjectStore.getState().project ?? project);
      const finder = await findSubjects(project, data, dir ?? "", result.placed.map((p) => p.sceneId));
      const byScene = new Map(scenes.map((s) => [s.id, s]));
      const placing = placeAll(result.placed, {
        caption: captionZone(data.captions.style, project.settings.aspectRatio),
        safe: safeArea(kit.safeMargins),
        subjectsFor: finder.subjectsFor,
        compactFor: (item) => { const s = byScene.get(item.sceneId); return s ? (fallbackFor(s)?.spec ?? null) : null; },
      });
      const placed: Placed[] = placing.placed;
      setNotes([...(finder.note ? [finder.note] : []), ...placing.notes.filter((n) => n.action !== "kept").map((n) => `${n.sceneId}: ${n.reason}.`)]);
      if (result.failed) setError(toAppError(result.failed.error, "The AI could not be reached. Graphics made before that are kept."));
      for (const [i, p] of placed.entries()) {
        const id = newGraphicId();
        try {
          made.push(await drawGraphic(project, dir, theme, { id, sceneId: p.sceneId, start: p.start, duration: p.duration, spec: p.spec, origin: "director" }, `Drawing graphic ${i + 1} of ${placed.length}`));
          processed.add(p.sceneId);
        } catch (e) {
          if (isCancelled(e)) throw e;
          setError(toAppError(e, "A graphic could not be drawn."));
        }
      }
      const fallbacks = placed.filter((p) => p.source === "fallback").length;
      complete = !result.failed && made.length === placed.length;
      note = `${made.length} graphic${made.length === 1 ? "" : "s"} added${fallbacks > 0 ? ` (${fallbacks} simple one${fallbacks === 1 ? "" : "s"} because the AI's answer could not be used)` : ""}. ${result.skipped.length} scene${result.skipped.length === 1 ? "" : "s"} left clean.`;
    } catch (e) {
      if (isCancelled(e)) setCancelled(true);
      else setError(toAppError(e, "The graphics could not be planned."));
    } finally {
      if (made.length > 0 || processed.size > 0) {
        const data = readEditor(useProjectStore.getState().project ?? project);
        // New director graphics replace the old ones of the scenes they were made for (a finished whole-project run: all old director graphics; a stopped run or one scene: only the scenes that got a new one).
        const replaced = !only && complete ? new Set(project.scenes.map((s) => s.id)) : processed;
        const rest = data.motion.filter((g) => !(g.origin === "director" && replaced.has(g.sceneId)));
        applyEdit({ editor: { ...data, motion: [...rest, ...made].sort((a, b) => a.start - b.start) } });
      }
      if (note) setSummary(note);
    }
  };

  return { job, error, cancelled, summary, notes, density, setDensity, generate };
}
