/** Phase 01 contracts only: no browser, storage, network, or job lifecycle. */
export type ScriptProviderMode = "claude_browser_assisted" | "claude_api" | "local_model";

/** A value snapshot, not a reference to mutable channel settings. */
export interface MasterPromptSnapshot {
  readonly channelId: string;
  readonly content: string;
  readonly versionId: string;
  /** Full SHA-256 over the exact UTF-8 content, prefixed with `sha256:`. */
  readonly contentDigest: string;
  /** Optional caller-provided ISO date. No implicit clock reads in this core. */
  readonly createdAt?: string;
}

export interface ScriptGenerationRequest {
  /** Caller-generated stable ID; can exist before a video project does. */
  readonly requestId: string;
  readonly channelId: string;
  readonly projectId?: string | null;
  readonly title: string;
  readonly topic: string;
  /** Empty means unspecified, not English. */
  readonly language: string;
  /** Null means the channel master prompt determines length. */
  readonly requestedWords: number | null;
  readonly targetAudience: string;
  readonly narrationTone: string;
  readonly storytellingStyle: string;
  readonly providerMode: ScriptProviderMode;
  readonly additionalInstructions: string;
  readonly masterPrompt: MasterPromptSnapshot;
}

/** Overrides apply only when present; an explicit empty string stays empty. */
export interface ScriptGenerationDraft {
  readonly requestId: string;
  readonly projectId?: string | null;
  readonly title: string;
  readonly topic: string;
  readonly language?: string;
  readonly requestedWords?: number | null;
  readonly targetAudience?: string;
  readonly narrationTone?: string;
  readonly storytellingStyle?: string;
  readonly additionalInstructions?: string;
  readonly providerMode: ScriptProviderMode;
  readonly masterPromptVersionId?: string;
  readonly snapshotCreatedAt?: string;
}

export interface ScriptValidationIssue {
  readonly field: string;
  readonly code: "required" | "invalid" | "too_long" | "out_of_range" | "mismatch";
  readonly message: string;
}

export interface ScriptValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ScriptValidationIssue[];
}

export interface CompiledScriptPrompt {
  readonly requestId: string;
  readonly channelId: string;
  readonly promptText: string;
  readonly masterPrompt: MasterPromptSnapshot;
  readonly validation: ScriptValidationResult;
  readonly metadata: Readonly<{
    formatVersion: "script-prompt-v1";
    providerMode: ScriptProviderMode;
    requestedWords: number | null;
    subjectEncoding: "json";
  }>;
}

export type ScriptCompilationResult =
  | { readonly ok: true; readonly compiled: CompiledScriptPrompt; readonly validation: ScriptValidationResult }
  | { readonly ok: false; readonly compiled: null; readonly validation: ScriptValidationResult };
