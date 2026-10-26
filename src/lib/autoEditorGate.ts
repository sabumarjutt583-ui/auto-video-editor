import { QUICK_ID } from "./quick/textScenes.ts";

export type AutoEditorGate = { ok: true } | { ok: false; message: string };

/**
 * The pure part of AutoEditorPage: when the editor may open, and which
 * guide message it shows instead. The messages are exactly the ones the
 * page shows, so changing a message here changes the page too.
 */
export function autoEditorGate(
  project: { id: string; scenes: readonly unknown[] } | null | undefined,
): AutoEditorGate {
  if (!project) return { ok: false, message: "Open a project first. The Auto Editor builds the video from the scenes of a project." };
  if (project.id === QUICK_ID) return { ok: false, message: "Quick prompts has no editor. Press 'Save as project' in the Prompt Generator first, then come back here." };
  if (project.scenes.length === 0) return { ok: false, message: "This project has no scenes yet. Build the scenes in the Prompt Generator first, then come back here." };
  return { ok: true };
}
