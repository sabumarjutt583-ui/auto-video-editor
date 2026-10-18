import type { Project } from "../types/project.ts";

export type StepId = "voice" | "timing" | "scenes" | "style" | "prompts";

export interface StepAccess {
  enabled: boolean;
  done: boolean;
  /** Why the step is not available yet. */
  reason: string;
}

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "voice", label: "Voice" },
  { id: "timing", label: "Timing" },
  { id: "scenes", label: "Scenes" },
  { id: "style", label: "Style & cast" },
  { id: "prompts", label: "Prompts" },
];

/** Which steps of the Prompt Generator can be used, and which are finished. */
export function stepAccess(project: Project): Record<StepId, StepAccess> {
  const hasWords = project.words.length > 0;
  const hasScenes = project.scenes.length > 0;
  const hasStyle = project.styleId !== null;
  return {
    voice: { enabled: true, done: project.voiceLocked, reason: "" },
    timing: { enabled: project.voiceLocked, done: hasWords, reason: "Lock the voice first." },
    scenes: { enabled: hasWords, done: hasScenes, reason: "Get the word timings first." },
    style: { enabled: hasScenes, done: hasStyle, reason: "Build the scenes first." },
    prompts: {
      enabled: hasScenes && hasStyle,
      done: hasScenes && project.scenes.every((scene) => scene.prompt.trim() !== ""),
      reason: hasScenes ? "Choose a style first." : "Build the scenes first.",
    },
  };
}
