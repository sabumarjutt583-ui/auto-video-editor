import type { EditorData, MediaFile } from "../../types/editor.ts";
import type { Scene } from "../../types/project.ts";
import { TIME_TOLERANCE } from "./place.ts";

export type Severity = "red" | "orange" | "grey";
export type IssueKind = "missing" | "file_missing" | "duplicate" | "short" | "overlap" | "gap" | "time_mismatch";

export interface Issue {
  kind: IssueKind;
  severity: Severity;
  /** The scene the problem is about (the later one for overlaps and gaps). */
  sceneId: string;
  message: string;
  /** For "short": how many seconds are missing. */
  seconds?: number;
  /** For "file_missing": the file that is gone. */
  path?: string;
}

const ORDER: Record<Severity, number> = { red: 0, orange: 1, grey: 2 };
/** Differences smaller than this are rounding, not problems. */
const EPSILON = 0.05;

function seconds(value: number): string {
  return value.toFixed(1);
}

/**
 * Checks the media of every scene. `exists` says which project files are still on disk
 * (a path that is not listed is treated as present).
 */
export function validate(
  scenes: readonly Scene[],
  editor: Pick<EditorData, "media" | "timeChoices">,
  mediaMap: Readonly<Record<string, string>>,
  exists: Readonly<Record<string, boolean>>,
): Issue[] {
  const issues: Issue[] = [];
  const present = (file: MediaFile) => exists[file.path] !== false;
  const chosenOf = new Map<string, MediaFile>();

  for (const scene of scenes) {
    const candidates = editor.media.filter((m) => m.sceneId === scene.id);
    const alive = candidates.filter(present);
    for (const file of candidates.filter((m) => !present(m))) {
      // Not a problem any more when the scene has another file to use.
      issues.push({ kind: "file_missing", severity: alive.length > 0 ? "orange" : "red", sceneId: scene.id, path: file.path, message: `${file.name} was deleted from the project folder.` });
    }
    const chosen = alive.find((m) => m.path === mediaMap[scene.id]) ?? alive[0];
    if (!chosen) {
      issues.push({ kind: "missing", severity: "red", sceneId: scene.id, message: `${scene.id} has no picture or clip.` });
      continue;
    }
    chosenOf.set(scene.id, chosen);
    if (alive.length > 1) {
      issues.push({ kind: "duplicate", severity: "orange", sceneId: scene.id, message: `${scene.id} has ${alive.length} files. Choose the one to use.` });
    }
    if (chosen.kind === "video" && scene.duration - chosen.duration > EPSILON) {
      const gap = scene.duration - chosen.duration;
      issues.push({
        kind: "short",
        severity: "orange",
        sceneId: scene.id,
        seconds: gap,
        message: `The clip for ${scene.id} is ${seconds(gap)} s shorter than the scene (${seconds(chosen.duration)} s of ${seconds(scene.duration)} s).`,
      });
    }
    if (chosen.start !== null && chosen.end !== null && editor.timeChoices[scene.id] === undefined) {
      if (Math.abs(chosen.start - scene.start) > TIME_TOLERANCE || Math.abs(chosen.end - scene.end) > TIME_TOLERANCE) {
        issues.push({
          kind: "time_mismatch",
          severity: "orange",
          sceneId: scene.id,
          message: `The name of ${chosen.name} says ${seconds(chosen.start)} to ${seconds(chosen.end)} s, but the project says ${seconds(scene.start)} to ${seconds(scene.end)} s.`,
        });
      }
    }
  }

  // Timecodes written in the file names, for the scenes that follow them.
  const timed = scenes
    .map((scene) => ({ scene, file: chosenOf.get(scene.id) }))
    .filter((item): item is { scene: Scene; file: MediaFile } => item.file !== undefined && item.file.start !== null && item.file.end !== null && editor.timeChoices[item.scene.id] !== "project")
    .sort((a, b) => (a.file.start ?? 0) - (b.file.start ?? 0));
  for (let i = 1; i < timed.length; i += 1) {
    const before = timed[i - 1];
    const after = timed[i];
    if (!before || !after) continue;
    const overlap = (before.file.end ?? 0) - (after.file.start ?? 0);
    if (overlap > EPSILON) {
      issues.push({
        kind: "overlap",
        severity: "red",
        sceneId: after.scene.id,
        message: `${after.scene.id} (${seconds(after.file.start ?? 0)} to ${seconds(after.file.end ?? 0)} s) overlaps ${before.scene.id} (${seconds(before.file.start ?? 0)} to ${seconds(before.file.end ?? 0)} s) by ${seconds(overlap)} s.`,
      });
    } else if (-overlap > EPSILON && scenes.indexOf(after.scene) - scenes.indexOf(before.scene) === 1) {
      // Only neighbouring scenes: a scene without media in between is already reported as missing.
      issues.push({
        kind: "gap",
        severity: "grey",
        sceneId: after.scene.id,
        seconds: -overlap,
        message: `There is a ${seconds(-overlap)} s gap before ${after.scene.id}. It is closed automatically by extending ${before.scene.id}.`,
      });
    }
  }

  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** How many scenes have a usable file. */
export function matchedCount(scenes: readonly Scene[], editor: Pick<EditorData, "media">, exists: Readonly<Record<string, boolean>>): number {
  return scenes.filter((scene) => editor.media.some((m) => m.sceneId === scene.id && exists[m.path] !== false)).length;
}
