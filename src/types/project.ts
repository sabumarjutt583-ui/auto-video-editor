import type { EditorData } from "./editor";
import type { AspectRatio, Quality } from "./settings";

/** Bump together with SCHEMA_VERSION in src-tauri/src/project/model.rs. */
export const SCHEMA_VERSION = 3;

export type TimingSource = "srt" | "json" | "groq";
export type MediaType = "image" | "video";
export type SceneStatus = "pending" | "prompt_ready" | "matched";

/** One spoken word with its time in seconds. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Scene {
  /** "S01", "S02", ... */
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
  /** Exact wording from the user's script. */
  text: string;
  mediaType: MediaType;
  prompt: string;
  motionPrompt: string;
  matchedFile: string | null;
  status: SceneStatus;
  /** Which spoken sentences the scene covers (0-based, inclusive). */
  firstSentence: number;
  lastSentence: number;
  /** Which words (indexes in `words`, inclusive) the scene covers. */
  firstWord: number;
  lastWord: number;
  /** The English scene description written by the AI. */
  description: string;
  /** True once the user has edited the final prompt by hand. */
  edited: boolean;
  /** The negative prompt that goes with `prompt` for the chosen tool. */
  negative: string;
  /** Characters (ids from characterBible) and the location that appear in this scene. */
  characterIds: string[];
  locationId: string | null;
  /** What the app repaired in a prompt from the web chat ("added the style lock"), and things to check. */
  fixNotes?: string[];
}

/** A person who must look the same in every prompt. */
export interface Character {
  id: string;
  name: string;
  role: string;
  /** ONE fixed English description of how the person looks. */
  appearance: string;
}

/** A place that must look the same in every prompt. */
export interface Location {
  id: string;
  name: string;
  description: string;
  /** Optional sound mood: "calm", "tense" or "nature". Picks the ambience sound under the scenes of this place. */
  mood?: string;
}

/** A stretch of the voice-over in seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

export type CleanupMode = "none" | "cut" | "skipped";

/** Silence-removal choices and what was done (step 1 of the Prompt Generator). */
export interface VoiceCleanup {
  mode: CleanupMode;
  thresholdDb: number;
  /** Silences at least this long (seconds) are cut. */
  minSilence: number;
  /** Seconds of silence kept around speech. */
  padding: number;
  normalize: boolean;
}

export type SceneMode = "sentence" | "seconds" | "ai";

export interface SceneSettings {
  mode: SceneMode;
  /** Used by the per-sentence mode: 1 to 4. */
  sentencesPerScene: number;
  /** Used by the per-seconds mode. */
  targetSeconds: number;
  /** Video scenes longer than this are split into a/b parts. */
  maxVideoSeconds: number;
  /** Scenes shorter than this are joined to a neighbour (seconds). */
  minSeconds?: number;
}

export type OutputType = "image" | "video" | "image_motion";
export type DetailLevel = "short" | "medium" | "detailed";
export type TargetTool = "generic" | "midjourney" | "stable_diffusion" | "flux" | "dalle_gemini" | "video";

export interface PromptSettings {
  outputType: OutputType;
  detail: DetailLevel;
  tool: TargetTool;
}

export interface ProjectSettings {
  aspectRatio: AspectRatio;
  quality: Quality;
}

/**
 * Mirrors src-tauri/src/project/model.rs.
 * Paths are relative to the project folder (e.g. "audio/voice.wav") or absolute.
 */
export interface MakeVideoRun {
  /** "running" | "paused" | "stopped" | "failed" | "finished" — "running" after a restart means the run was interrupted (crash/close). */
  status: string;
  currentStage: string;
  completedStages: string[];
  failedScenes: string[];
  updatedAt: string;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  /** ISO 8601, UTC. */
  createdAt: string;
  /** Set by the app on every save. */
  updatedAt: string;
  voicePath: string | null;
  voiceLocked: boolean;
  /** Seconds. */
  voiceDuration: number;
  /** Language of the narration, e.g. "ko". Empty until chosen. */
  language: string;
  timingSource: TimingSource | null;
  words: Word[];
  scenes: Scene[];
  settings: ProjectSettings;
  characterBible: Character[];
  locationBible: Location[];
  /** When true, prompt generation must use the bible texts exactly as they are. */
  bibleLocked: boolean;
  styleId: string | null;
  /** The original voice file inside the project folder (e.g. "audio/original.mp3"). */
  voiceOriginalPath: string | null;
  voiceOriginalDuration: number;
  voiceSampleRate: number;
  voiceChannels: number;
  voiceCleanup: VoiceCleanup;
  /** Ranges removed from the original voice, in original time. */
  cutMap: TimeRange[];
  /** The exact script the user pasted (may be empty). */
  script: string;
  /** Step 0 audit record for the script, when it was made with Step 0 (older projects leave these empty). */
  /** Where the script came from: "claude" or "typed". Empty = unknown (older project). */
  scriptSource?: string;
  /** The title/topic given to Claude, or "" for a typed script. */
  scriptTopic?: string;
  /** The word count asked for, or 0 when none was asked (the project file stores a number, never null). */
  scriptWordsRequested?: number;
  /** The fingerprint of the master prompt used (see lib/script/step0.ts). */
  scriptMasterPromptVersion?: string;
  /** True when word times were estimated from line-level times (SRT/VTT). */
  timingEstimated: boolean;
  /** How well the script matched the timed words, 0 to 100. */
  alignmentQuality: number | null;
  /** Indexes of script words that were not found in the speech. */
  unmatchedWords: number[];
  sceneSettings: SceneSettings;
  promptSettings: PromptSettings;
  /** Scene id ("S01") to media file. */
  mediaMap: Record<string, string>;
  /** When the final video was last rendered; null until the first render. */
  renderedAt: string | null;
  /** Measured length of the last finished video in seconds (null until a render saves it; never guessed). */
  exportDurationSeconds?: number | null;
  /** File size of the last finished video in bytes (null until a render saves it; never guessed). */
  exportSizeBytes?: number | null;
  /** Per-scene caption text overrides, keyed by scene id, used by the next render. */
  captionOverrides?: Record<string, string>;
  /** Last Make Video run state, updated as the run progresses (crash resume). */
  makeVideoRun?: MakeVideoRun | null;
  /** What the Auto Editor adds. May be null or partly filled in older projects: read it with `readEditor`. */
  editor: Partial<EditorData> | null;
  /** Id of the part being worked on ("" = the only part, "Part 1"). */
  activePartId: string;
  /** Name of the part being worked on ("" = "Part 1"). */
  partName: string;
  /** The other parts of a voice-over in several parts (their own voice, timing, scenes and editor). */
  parts: VoicePart[];
  /** The channel profile this video was made for ("" = none; older projects). */
  channelId: string;
}

/** A voice-over part that is not open right now. `snapshot` holds its own project fields. */
export interface VoicePart {
  id: string;
  name: string;
  snapshot: Record<string, unknown>;
}

/** Fields the app edits. The rest are controlled by the system. */
export type ProjectPatch = Partial<Omit<Project, "id" | "schemaVersion" | "createdAt" | "updatedAt">>;

export type ProjectStatus = "prompts_ready" | "media_matched" | "rendered";

/** The small version of a project shown on a card. */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  voiceDuration: number;
  sceneCount: number;
  /** null while the project is still being set up. */
  status: ProjectStatus | null;
  /** The channel this video belongs to ("" = none). */
  channelId: string;
  /** What is finished so far (the steps of "Make video"), for the Channels dashboard. */
  /** True when the project has a saved script (Step 0). Missing on older summaries = unknown. */
  hasScript?: boolean;
  voiceLocked: boolean;
  hasWords: boolean;
  bibleLocked: boolean;
  promptsWritten: number;
  /** Image scenes with a prompt, and how many of them already have a picture. */
  pictureScenes: number;
  pictures: number;
  audioMixed: boolean;
  rendered: boolean;
  exportDurationSeconds?: number | null;
  exportSizeBytes?: number | null;
  makeVideoRun?: MakeVideoRun | null;
}

/** A project folder that could not be read (damaged file, newer app version, ...). */
export interface UnreadableProject {
  id: string;
  message: string;
  details: string;
}

export interface ProjectList {
  projects: ProjectSummary[];
  unreadable: UnreadableProject[];
}
