import type { Project, ProjectPatch } from "../../types/project.ts";
import { readEditor } from "../editor/model.ts";

const equal = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Invalidate derived data, never delete media files. Explicit replacement
 * outputs in a patch win over defaults (e.g. importing timings with a script). */
export function invalidateProject(project: Project, patch: ProjectPatch): ProjectPatch {
  // Part snapshots already contain their own complete dependency state.
  if (patch.activePartId !== undefined && patch.activePartId !== project.activePartId) return patch;
  const changed = (key: keyof ProjectPatch) => key in patch && !equal(project[key], patch[key]);
  const script = changed("script") && Boolean(project.script?.trim()) && !("words" in patch);
  const voice = script || changed("voicePath") || changed("voiceDuration") || changed("voiceOriginalPath");
  const timing = voice || changed("words");
  const structure = timing || changed("sceneSettings");
  const style = changed("styleId") || changed("promptSettings") || changed("characterBible") || changed("locationBible");
  const defaults: ProjectPatch = {};
  if (script) Object.assign(defaults, { voiceOriginalPath: null, voiceOriginalDuration: 0, voicePath: null, voiceDuration: 0, voiceLocked: false, cutMap: [], bibleLocked: false });
  if (voice) Object.assign(defaults, { words: [], timingSource: null, alignmentQuality: null, unmatchedWords: [], timingEstimated: false });
  if (structure) Object.assign(defaults, { scenes: [], mediaMap: {}, captionOverrides: {} });
  let next: ProjectPatch = { ...defaults, ...patch };
  const scenes = next.scenes ?? project.scenes ?? [];
  if (style && !structure) {
    next = { ...next, scenes: scenes.map((scene) => ({ ...scene, prompt: "", motionPrompt: "", matchedFile: null, status: "pending" })), mediaMap: {} };
  }
  const renderKeys: (keyof ProjectPatch)[] = ["script", "voicePath", "voiceDuration", "voiceOriginalPath", "voiceCleanup", "words", "scenes", "sceneSettings", "styleId", "promptSettings", "characterBible", "locationBible", "mediaMap", "settings", "editor", "captionOverrides", "language"];
  if (!renderKeys.some(changed)) return next;

  if (project.makeVideoRun && !patch.makeVideoRun) {
    const order = ["script", "voice", "timing", "scenes", "cast", "prompts", "images", "audio", "render"];
    const first = changed("script") ? 0 : voice ? 1 : timing ? 2 : structure ? 3 : style ? 4 : changed("scenes") ? 5 : changed("mediaMap") ? 6 : 7;
    next.makeVideoRun = { ...project.makeVideoRun,
      approvedStages: (project.makeVideoRun.approvedStages ?? []).filter((stage) => order.indexOf(stage) >= 0 && order.indexOf(stage) < first),
    };
  }
  const before = readEditor(project);
  const after = readEditor({ ...project, ...next });
  const withoutMix = (audio: typeof before.audio) => { const { mix: _mix, ...inputs } = audio; return inputs; };
  const audioChanged = timing || changed("scenes") || changed("locationBible") ||
    !equal(withoutMix(before.audio), withoutMix(after.audio)) ||
    !equal(before.motion, after.motion) || !equal(before.overrides, after.overrides) ||
    !equal(before.captions, after.captions) || before.render.transitions !== after.render.transitions;
  if (audioChanged || structure) {
    next.editor = { ...after, audio: { ...after.audio, mix: null },
      ...(timing ? { captions: { ...after.captions, lines: null } } : {}),
      ...(structure ? { overrides: {}, motion: [] } : {}),
    };
  }
  next.renderedAt = null;
  next.exportDurationSeconds = null;
  next.exportSizeBytes = null;
  if (project.makeVideoRun?.status === "finished" && !patch.makeVideoRun) {
    next.makeVideoRun = { ...(next.makeVideoRun ?? project.makeVideoRun), status: "stopped", currentStage: "", completedStages: [], updatedAt: new Date().toISOString() };
  }
  return next;
}
