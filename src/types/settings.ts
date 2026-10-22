export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Quality = "720p" | "1080p" | "4K";

/** Non-secret settings, stored as JSON in the app data folder (mirrors settings.rs). */
export interface AppSettings {
  geminiModel: string;
  groqWhisperModel: string;
  fallbackToGroq: boolean;
  groqTextModel: string;
  /** Write texts with Gemini's web chat (Google accounts) instead of the Gemini API key. */
  textViaChat: boolean;
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
}
