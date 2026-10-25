/** The steps "Make video" runs, in order. */
export type StageId = "voice" | "timing" | "scenes" | "cast" | "prompts" | "images" | "audio" | "render";

export interface StageInfo {
  id: StageId;
  label: string;
  /** What the step does, in plain words. */
  hint: string;
}

export const STAGES: readonly StageInfo[] = [
  { id: "voice", label: "Voice", hint: "Make the voice from the script (or use your own file), clean it and lock it." },
  { id: "timing", label: "Word timing", hint: "Get the time of every word from the voice." },
  { id: "scenes", label: "Scenes", hint: "Cut the narration into scenes." },
  { id: "cast", label: "Characters and places", hint: "Find who and where, so every picture looks the same." },
  { id: "prompts", label: "Prompts", hint: "Write a picture prompt for every scene in the channel's style." },
  { id: "images", label: "Pictures", hint: "Make a picture for every scene." },
  { id: "audio", label: "Music and sounds", hint: "Add music and sound effects and mix the audio." },
  { id: "render", label: "Final video", hint: "Build the timeline, add captions and render the MP4." },
];

export const STAGE_IDS: readonly StageId[] = STAGES.map((stage) => stage.id);

export function stageLabel(id: StageId): string {
  return STAGES.find((stage) => stage.id === id)?.label ?? id;
}

/** Which steps stop and wait for a "Continue" press. true = ask first. */
export type Pauses = Record<StageId, boolean>;

export const NO_PAUSES: Pauses = { voice: false, timing: false, scenes: false, cast: false, prompts: false, images: false, audio: false, render: false };
