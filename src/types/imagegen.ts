/** Mirrors src-tauri/src/imagegen (engine.rs, accounts.rs, settings.rs, queue.rs). */

export type GenEngine = "free" | "api";
export type ApiProvider = "gemini" | "cloudflare";
export type BrowserMode = "hidden" | "window";
export type PictureAspect = "16:9" | "1:1" | "9:16";

export interface Consent {
  acceptedAt: string;
  configMajor: number;
}

export interface ImageGenSettings {
  engine: GenEngine;
  apiProvider: ApiProvider;
  geminiImageModel: string;
  cloudflareAccountId: string;
  cloudflareModel: string;
  /** "If Free fails or all accounts hit their limit, continue with API". */
  fallbackToApi: boolean;
  /** Pictures made at the same time, 1 to 8. */
  parallel: number;
  maxAttempts: number;
  timeoutSec: number;
  browserMode: BrowserMode;
  browserPath: string;
  browserNote: string;
  consent: Consent | null;
}

export type JobStatus = "queued" | "generating" | "completed" | "failed";
export type Via = "free" | "gemini" | "cloudflare";

export type GenErrorKind =
  | "auth"
  | "access"
  | "rate_limit"
  | "flagged"
  | "session"
  | "network"
  | "aborted"
  | "timeout"
  | "no_image"
  | "blocked"
  | "bad_request"
  | "server"
  | "storage"
  | "unknown";

export interface ImageJob {
  id: string;
  order: number;
  fileName: string;
  status: JobStatus;
  attempts: number;
  accountId: string | null;
  via: Via | null;
  /** Saved picture, relative to the project folder. */
  file: string | null;
  error: string;
  errorKind: GenErrorKind | null;
  regenerate: boolean;
  nextAttemptAt: number;
}

export type AccountStatus =
  | "not_connected"
  | "signed_out"
  | "paused"
  | "flagged"
  | "unverified"
  | "signing_in"
  | "checking"
  | "testing"
  | "limit_reached"
  | "busy"
  | "ready";

export interface AccountView {
  id: string;
  name: string;
  email: string;
  status: AccountStatus;
  verified: "unknown" | "yes" | "no";
  verifyMessage: string;
  enabled: boolean;
  active: number;
  /** Milliseconds since 1970; 0 when there is no pause. */
  cooldownUntil: number;
  cooldownReason: string;
  lastError: string;
  flagged: string;
  stats: { completed: number; failed: number };
}

export type NoticeKind = "consent" | "no_account" | "signing_in" | "all_limited" | "needs_attention" | "api_key_missing" | "storage" | "waiting_retry";

export interface Notice {
  kind: NoticeKind;
  text: string;
  until: number;
}

export interface QueueStats {
  total: number;
  queued: number;
  generating: number;
  completed: number;
  failed: number;
}

export interface ImageGenSnapshot {
  projectDir: string | null;
  running: boolean;
  stats: QueueStats;
  jobs: ImageJob[];
  accounts: AccountView[];
  settings: ImageGenSettings;
  configVersion: string;
  consentNeeded: boolean;
  apiReady: boolean;
  notice: Notice | null;
  now: number;
}

/** One scene to make a picture for. The page builds these; Rust checks them again. */
export interface NewImageJob {
  sceneId: string;
  fileName: string;
  prompt: string;
  aspect: PictureAspect;
}

export interface AddReport {
  added: number;
  skipped: number;
  regenerating: number;
}

/** A picture was saved in the project's media folder. */
export interface SavedImage {
  projectDir: string;
  sceneId: string;
  path: string;
  name: string;
  width: number;
  height: number;
  modified: number;
  regenerated: boolean;
  alreadySaved: boolean;
}

export interface TestImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface MediaInfo {
  path: string;
  name: string;
  kind: "image";
  width: number;
  height: number;
  duration: number;
  modified: number;
}
