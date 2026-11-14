import type { ChannelProfile } from "../../pipeline/profile.ts";
import { MAX_MASTER_PROMPT, MAX_TOPIC } from "../prompt.ts";
import { MAX_WORD_COUNT, MIN_WORD_COUNT } from "../step0.ts";
import { sha256Hex } from "./fingerprint.ts";
import type { MasterPromptSnapshot, ScriptGenerationDraft, ScriptGenerationRequest, ScriptValidationIssue, ScriptValidationResult } from "./types.ts";

/** No Date.now/Math.random: callers own identity and time; compilation is reproducible. */
export function snapshotMasterPrompt(channelId: string, content: string, versionId?: string, createdAt?: string): MasterPromptSnapshot {
  const contentDigest = `sha256:${sha256Hex(content)}`;
  return Object.freeze({ channelId, content, versionId: versionId ?? contentDigest, contentDigest, ...(createdAt === undefined ? {} : { createdAt }) });
}

/** Converts an existing saved channel profile without changing its storage shape.
 * An explicit per-video language (including "") overrides the channel default. */
export function requestFromChannelProfile(
  profile: Pick<ChannelProfile, "id" | "language" | "script">,
  draft: ScriptGenerationDraft,
): ScriptGenerationRequest {
  return Object.freeze({
    requestId: draft.requestId,
    channelId: profile.id,
    ...(draft.projectId === undefined ? {} : { projectId: draft.projectId }),
    title: draft.title,
    topic: draft.topic,
    language: draft.language ?? profile.language,
    requestedWords: draft.requestedWords ?? null,
    targetAudience: draft.targetAudience ?? "",
    narrationTone: draft.narrationTone ?? "",
    storytellingStyle: draft.storytellingStyle ?? "",
    additionalInstructions: draft.additionalInstructions ?? "",
    providerMode: draft.providerMode,
    masterPrompt: snapshotMasterPrompt(profile.id, profile.script.masterPrompt, draft.masterPromptVersionId, draft.snapshotCreatedAt),
  });
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PROVIDERS = ["claude_browser_assisted", "claude_api", "local_model"] as const;
const MAX_TITLE = 200;
const MAX_ID = 128;

/** Validates rather than silently clamping, trimming, or changing caller input. */
export function validateScriptRequest(request: ScriptGenerationRequest): ScriptValidationResult {
  const errors: ScriptValidationIssue[] = [];
  const add = (field: string, code: ScriptValidationIssue["code"], message: string) => errors.push({ field, code, message });
  const stringField = (field: string, value: unknown, max: number, required = false): void => {
    if (typeof value !== "string" || (required && value.trim() === "")) {
      add(field, required ? "required" : "invalid", `${field} must ${required ? "be a non-empty" : "be a"} string.`);
    } else if (value.length > max) {
      add(field, "too_long", `${field} must contain at most ${max} characters.`);
    }
  };
  const idField = (field: string, value: unknown): void => {
    stringField(field, value, MAX_ID, true);
    if (typeof value === "string" && value.trim() !== "" && value.length <= MAX_ID && !ID.test(value)) {
      add(field, "invalid", `${field} may contain only ASCII letters, digits, underscores and hyphens, and must begin with a letter or digit.`);
    }
  };
  idField("requestId", request.requestId);
  idField("channelId", request.channelId);
  if (request.projectId !== null && request.projectId !== undefined) idField("projectId", request.projectId);
  stringField("title", request.title, MAX_TITLE);
  stringField("topic", request.topic, MAX_TOPIC);
  if (typeof request.title === "string" && typeof request.topic === "string" && !request.title.trim() && !request.topic.trim()) {
    add("title", "required", "Provide at least a video title or a topic.");
  }
  stringField("language", request.language, 120);
  stringField("targetAudience", request.targetAudience, 500);
  stringField("narrationTone", request.narrationTone, 300);
  stringField("storytellingStyle", request.storytellingStyle, 500);
  stringField("additionalInstructions", request.additionalInstructions, 4000);
  if (request.requestedWords !== null && (!Number.isSafeInteger(request.requestedWords) || request.requestedWords < MIN_WORD_COUNT || request.requestedWords > MAX_WORD_COUNT)) {
    add("requestedWords", "out_of_range", `requestedWords must be null or a whole number between ${MIN_WORD_COUNT} and ${MAX_WORD_COUNT}.`);
  }
  if (!PROVIDERS.includes(request.providerMode)) {
    add("providerMode", "invalid", "Choose a supported script provider mode.");
  }
  const snapshot = request.masterPrompt;
  if (!snapshot || typeof snapshot !== "object") {
    add("masterPrompt", "required", "A master prompt snapshot is required.");
  } else {
    idField("masterPrompt.channelId", snapshot.channelId);
    stringField("masterPrompt.content", snapshot.content, MAX_MASTER_PROMPT, true);
    stringField("masterPrompt.versionId", snapshot.versionId, 120, true);
    if (snapshot.channelId !== request.channelId) {
      add("masterPrompt.channelId", "mismatch", "The master prompt snapshot belongs to a different channel.");
    }
    if (typeof snapshot.content !== "string" || snapshot.contentDigest !== `sha256:${sha256Hex(snapshot.content)}`) {
      add("masterPrompt.contentDigest", "mismatch", "Master prompt content does not match its saved SHA-256 fingerprint.");
    }
    if (snapshot.createdAt !== undefined && (typeof snapshot.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(snapshot.createdAt) || Number.isNaN(Date.parse(snapshot.createdAt)))) {
      add("masterPrompt.createdAt", "invalid", "createdAt must be an ISO-8601 date-time when provided.");
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
