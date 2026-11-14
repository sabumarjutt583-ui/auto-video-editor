/** Phase 02A: prepare a new-core prompt from legacy Step 0/Make Video inputs.
 * This module is opt-in only: it never calls Claude or changes production paths. */
import type { ChannelProfile } from "../pipeline/profile.ts";
import { clampWordCount, masterPromptVersion } from "./step0.ts";
import { compileScriptPrompt } from "./core/compiler.ts";
import { requestFromChannelProfile } from "./core/request.ts";
import type { CompiledScriptPrompt, ScriptGenerationRequest, ScriptValidationIssue, ScriptValidationResult } from "./core/types.ts";

/** Accepts the Step 0 \`title\` field or MakeVideoInput's \`name\` field.
 * Settings fields are opt-in per-video overrides of the channel profile. */
export interface LegacyScriptVideoInput {
  readonly title?: string;
  readonly name?: string;
  readonly topic?: string;
  /** An existing pasted script should bypass AI writing, never be overwritten. */
  readonly script?: string;
  readonly wordCount?: number | null;
  readonly language?: string;
  readonly targetAudience?: string;
  readonly narrationTone?: string;
  readonly storytellingStyle?: string;
  readonly additionalInstructions?: string;
}

export interface LegacyScriptAdapterContext {
  /** Stable caller-assigned ID. The adapter never generates an ID or timestamp. */
  readonly requestId: string;
  /** Optional guard against an in-flight channel switch/stale UI selection. */
  readonly expectedChannelId?: string;
  /** New-video requests normally have no project ID yet. */
  readonly projectId?: string | null;
}

/** Audit hints only; not a replacement for the existing project ScriptRecord. */
export interface LegacyScriptAdapterMetadata {
  readonly requestId: string;
  readonly channelId: string;
  readonly projectId: string | null;
  readonly preferredClaudeAccountId: string | null;
  readonly legacyMasterPromptVersion: string;
  readonly masterPromptVersionId: string;
  readonly masterPromptDigest: string;
  readonly wordCountRequested: number | null;
  readonly promptFormatVersion: CompiledScriptPrompt["metadata"]["formatVersion"];
}

export type LegacyScriptAdapterResult =
  | { readonly ok: true; readonly request: ScriptGenerationRequest; readonly compiled: CompiledScriptPrompt; readonly metadata: LegacyScriptAdapterMetadata; readonly validation: ScriptValidationResult }
  | { readonly ok: false; readonly request: null; readonly compiled: null; readonly metadata: null; readonly validation: ScriptValidationResult };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(errors: readonly ScriptValidationIssue[]): LegacyScriptAdapterResult {
  return { ok: false, request: null, compiled: null, metadata: null,
    validation: { valid: false, errors: Object.freeze([...errors]) } };
}

function issue(field: string, code: ScriptValidationIssue["code"], message: string): ScriptValidationIssue {
  return { field, code, message };
}

/** Reads the legacy field shapes defensively (including JSON/untyped callers).
 *
 * Differences from the live path:
 * - Both names and subjects are trimmed as in writeScriptForStep0().
 * - Finite counts use legacy Math.round + clamp to [50, 20000]; NaN/Infinity,
 *   strings, and other malformed values are errors, not silent omissions.
 * - No account is selected or rotated; its saved preference is audit-only.
 * - Core emits a structured JSON-subject prompt, NOT the legacy Claude string.
 * - "off" channels, typed scripts, and absent master prompts do not generate.
 */
export function prepareLegacyScriptPrompt(
  profile: Pick<ChannelProfile, "id" | "language" | "script">,
  video: LegacyScriptVideoInput,
  context: LegacyScriptAdapterContext,
): LegacyScriptAdapterResult;
export function prepareLegacyScriptPrompt(profile: unknown, video: unknown, context: unknown): LegacyScriptAdapterResult;
export function prepareLegacyScriptPrompt(profile: unknown, video: unknown, context: unknown): LegacyScriptAdapterResult {
  const errors: ScriptValidationIssue[] = [];
  if (!isRecord(profile)) errors.push(issue("profile", "required", "Choose a valid channel profile."));
  if (!isRecord(video)) errors.push(issue("video", "required", "Video input must be an object."));
  if (!isRecord(context)) errors.push(issue("context", "required", "Supply a context with a stable requestId."));
  if (errors.length) return failure(errors);

  // Type narrowing via these bindings does not assert that their fields are valid.
  const selected = profile as Record<string, unknown>;
  const input = video as Record<string, unknown>;
  const ctx = context as Record<string, unknown>;
  if (typeof selected.id !== "string") errors.push(issue("profile.id", "invalid", "The channel ID must be a string."));
  if (typeof selected.language !== "string") errors.push(issue("profile.language", "invalid", "The channel language must be a string (empty means unspecified)."));
  if (!isRecord(selected.script)) errors.push(issue("profile.script", "required", "The channel's script settings are missing."));
  if (typeof ctx.requestId !== "string") errors.push(issue("requestId", "required", "Supply a stable request ID string."));
  if (ctx.expectedChannelId !== undefined && typeof ctx.expectedChannelId !== "string")
    errors.push(issue("expectedChannelId", "invalid", "The expected channel ID must be a string."));
  if (ctx.projectId !== undefined && ctx.projectId !== null && typeof ctx.projectId !== "string")
    errors.push(issue("projectId", "invalid", "The project ID must be a string, null, or omitted."));

  for (const field of ["title", "name", "topic", "script", "language", "targetAudience", "narrationTone", "storytellingStyle", "additionalInstructions"] as const) {
    if (input[field] !== undefined && typeof input[field] !== "string")
      errors.push(issue(field, "invalid", `${field} must be a string when provided.`));
  }
  const rawWords = input.wordCount;
  if (rawWords !== undefined && rawWords !== null && (typeof rawWords !== "number" || !Number.isFinite(rawWords)))
    errors.push(issue("wordCount", "invalid", "Word count must be a finite number, null, or omitted."));
  if (errors.length) return failure(errors);

  const script = selected.script as Record<string, unknown>;
  if (script.writer !== "claude")
    errors.push(issue("profile.script.writer", "invalid", "AI script generation requires the channel's Claude writer to be enabled."));
  if (typeof script.masterPrompt !== "string" || !script.masterPrompt.trim())
    errors.push(issue("profile.script.masterPrompt", "required", "The channel needs a non-empty master prompt."));
  if (script.claudeAccountId !== undefined && script.claudeAccountId !== null && typeof script.claudeAccountId !== "string")
    errors.push(issue("profile.script.claudeAccountId", "invalid", "Account preference must be a string, null, or omitted."));
  if (typeof input.script === "string" && input.script.trim() !== "")
    errors.push(issue("script", "invalid", "A pasted script must use the existing typed-script path; AI generation is not needed."));
  if (typeof ctx.expectedChannelId === "string" && ctx.expectedChannelId !== selected.id)
    errors.push(issue("expectedChannelId", "mismatch", "The selected channel has changed; do not use a different channel's prompt."));

  const providedTitle = typeof input.title === "string" ? input.title.trim() : "";
  const providedName = typeof input.name === "string" ? input.name.trim() : "";
  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  if (providedTitle && providedName && providedTitle !== providedName)
    errors.push(issue("title", "mismatch", "Video title and project name disagree; supply a single title."));
  if (errors.length) return failure(errors);

  // Make Video uses name = title || topic: don't duplicate a derived topic as a title.
  const title = providedTitle || (providedName !== topic ? providedName : "");
  const wordCount = rawWords === undefined || rawWords === null ? null : clampWordCount(rawWords as number);
  const channel = selected as unknown as Pick<ChannelProfile, "id" | "language" | "script">;
  const request = requestFromChannelProfile(channel, {
    requestId: ctx.requestId as string,
    ...(ctx.projectId === undefined ? {} : { projectId: ctx.projectId as string | null }),
    title,
    topic,
    requestedWords: wordCount,
    providerMode: "claude_browser_assisted",
    ...(input.language === undefined ? {} : { language: input.language as string }),
    ...(input.targetAudience === undefined ? {} : { targetAudience: input.targetAudience as string }),
    ...(input.narrationTone === undefined ? {} : { narrationTone: input.narrationTone as string }),
    ...(input.storytellingStyle === undefined ? {} : { storytellingStyle: input.storytellingStyle as string }),
    ...(input.additionalInstructions === undefined ? {} : { additionalInstructions: input.additionalInstructions as string }),
  });
  const result = compileScriptPrompt(request);
  if (!result.ok) return { ok: false, request: null, compiled: null, metadata: null, validation: result.validation };

  const metadata: LegacyScriptAdapterMetadata = Object.freeze({
    requestId: request.requestId,
    channelId: request.channelId,
    projectId: request.projectId ?? null,
    preferredClaudeAccountId: (typeof script.claudeAccountId === "string" && script.claudeAccountId !== "" ? script.claudeAccountId : null),
    legacyMasterPromptVersion: masterPromptVersion(request.masterPrompt.content),
    masterPromptVersionId: request.masterPrompt.versionId,
    masterPromptDigest: request.masterPrompt.contentDigest,
    wordCountRequested: request.requestedWords,
    promptFormatVersion: result.compiled.metadata.formatVersion,
  });
  return { ok: true, request, compiled: result.compiled, metadata, validation: result.validation };
}
