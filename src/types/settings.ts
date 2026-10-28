export type AspectRatio = "16:9" | "9:16" | "1:1";
export type TextProvider = "gemini" | "groq";
export type Quality = "720p" | "1080p" | "4K";

/** Non-secret settings, stored as JSON in the app data folder (mirrors settings.rs). */
export interface AppSettings {
  geminiModel: string;
  groqWhisperModel: string;
  fallbackToGroq: boolean;
  groqTextModel: string;
  /** The OpenAI model that looks at reference pictures when making a custom style. */
  openaiModel: string;
  /** Who writes the texts (scene groups, characters, prompts) with an API key. Word timing is always Groq. */
  textProvider: TextProvider;
  /** Scenes per request with the Gemini API key (5 to 20). */
  apiBatchSize: number;
  /** Requests at the same time with the Gemini API key (1 to 3). */
  apiParallel: number;
  /** Gemini speech model, ready-made voice and last style note for "Generate voice". */
  ttsModel: string;
  ttsVoice: string;
  ttsStyle: string;
  /** Who speaks: "gemini" (the default) or "edge" (Microsoft Edge TTS, free and unofficial, no key). */
  ttsProvider: "gemini" | "edge";
  /** The Microsoft voice used when the provider is Edge. */
  ttsEdgeVoice: string;
  /** Edge only: speaking rate (-50..+100) and volume (-100..+100) in percent. */
  ttsRate: number;
  ttsVolume: number;
  /** Empty lines after every prompt in Copy all and Export TXT (1 to 3). */
  exportEmptyLines: number;
  /** Write the id before every prompt in Copy all and Export TXT. */
  exportIncludeIds: boolean;
  /** Empty when no folder has been chosen yet. */
  exportFolder: string;
  defaultAspectRatio: AspectRatio;
  defaultQuality: Quality;
  /** Always encode on the CPU, even when a graphics-card encoder works. */
  forceCpuEncoding: boolean;
  /** Folder address that holds the sound and style packages (manifest.json). Empty = no updates. */
  libraryUpdateUrl: string;
  /** Ids of the sounds marked as favorites. */
  sfxFavorites: string[];
  /** Ids of the styles marked as favorites. */
  styleFavorites: string[];
  /** The last styles that were used, newest first (at most 6). */
  recentStyles: string[];
  /** Address of latest.json for app updates. Empty = the address built into the app. */
  appUpdateUrl: string;
  autoCheckAppUpdates: boolean;
  /** When the app last looked for a new version (seconds since 1970; 0 = never). */
  lastAppUpdateCheck: number;
  /** Write longer texts into the log files (for support). */
  debugLogging: boolean;
  /** The first-run screens were seen or skipped. */
  onboardingDone: boolean;
  /** Brand kits the person made (any JSON; `repairBrandKit` reads them). */
  brandKits: unknown[];
  /** The brand kit of the app (built-in, suggested or custom id). */
  brandKitId: string;
  /** Graphics saved as presets (any JSON; `readPresets` checks them). */
  graphicPresets: unknown[];
  /** Channel profiles for "Make video" (any JSON; `readProfiles` checks them). */
  channelProfiles: unknown[];
  /** The channel profile chosen on the Make video page (empty = none yet). */
  channelProfileId: string;
}
