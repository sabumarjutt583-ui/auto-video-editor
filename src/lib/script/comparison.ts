/** Phase 02B: pure and non-sending comparison of the existing Step 0 prompt
 * against the opt-in new compiler. No browser, Tauri job, storage or network. */
import type { ChannelProfile } from "../pipeline/profile.ts";
import { buildStep0Question } from "./step0.ts";
import {
  prepareLegacyScriptPrompt,
  type LegacyScriptAdapterContext,
  type LegacyScriptAdapterMetadata,
  type LegacyScriptVideoInput,
} from "./compatibility.ts";
import type { ScriptGenerationRequest, ScriptValidationResult } from "./core/types.ts";

export type ScriptComparisonFindingKind = "expected_difference" | "warning" | "problem";

export interface ScriptComparisonFinding {
  readonly kind: ScriptComparisonFindingKind;
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export interface ScriptPromptComparisonReport {
  readonly channelId: string | null;
  readonly requestId: string | null;
  readonly legacyFormatVersion: "legacy-step0-v1";
  readonly newFormatVersion: "script-prompt-v1";
  readonly legacyMasterPromptVersion: string | null;
  readonly masterPromptDigest: string | null;
  readonly masterPromptPreserved: boolean | null;
  readonly language: string | null;
  readonly requestedWords: number | null;
  readonly title: string | null;
  readonly topic: string | null;
  readonly targetAudience: string | null;
  readonly narrationTone: string | null;
  readonly storytellingStyle: string | null;
  readonly additionalInstructions: string | null;
  readonly expectedDifferences: readonly ScriptComparisonFinding[];
  readonly warnings: readonly ScriptComparisonFinding[];
  readonly problems: readonly ScriptComparisonFinding[];
}

export type ScriptPromptComparisonResult =
  | {
      readonly ok: true;
      readonly legacyPrompt: string;
      readonly newPrompt: string;
      readonly validation: ScriptValidationResult;
      readonly request: ScriptGenerationRequest;
      readonly metadata: LegacyScriptAdapterMetadata;
      readonly report: ScriptPromptComparisonReport;
    }
  | {
      readonly ok: false;
      readonly legacyPrompt: null;
      readonly newPrompt: null;
      readonly validation: ScriptValidationResult;
      readonly request: null;
      readonly metadata: null;
      readonly report: ScriptPromptComparisonReport;
    };

function finding(kind: ScriptComparisonFindingKind, code: string, message: string, field?: string): ScriptComparisonFinding {
  return Object.freeze({ kind, code, message, ...(field === undefined ? {} : { field }) });
}

function report(
  fields: Omit<ScriptPromptComparisonReport, "legacyFormatVersion" | "newFormatVersion" | "expectedDifferences" | "warnings" | "problems">,
  expectedDifferences: readonly ScriptComparisonFinding[],
  warnings: readonly ScriptComparisonFinding[],
  problems: readonly ScriptComparisonFinding[],
): ScriptPromptComparisonReport {
  return Object.freeze({
    ...fields,
    legacyFormatVersion: "legacy-step0-v1",
    newFormatVersion: "script-prompt-v1",
    expectedDifferences: Object.freeze([...expectedDifferences]),
    warnings: Object.freeze([...warnings]),
    problems: Object.freeze([...problems]),
  });
}

/** The same input is validated once, by Phase 02A. Only a successful result
 * can reach the existing legacy prompt builder or the new prompt output.
 * Expected formatting differences are informative, never validation errors. */
export function compareScriptPromptFormats(
  profile: Pick<ChannelProfile, "id" | "language" | "script">,
  video: LegacyScriptVideoInput,
  context: LegacyScriptAdapterContext,
): ScriptPromptComparisonResult;
export function compareScriptPromptFormats(profile: unknown, video: unknown, context: unknown): ScriptPromptComparisonResult;
export function compareScriptPromptFormats(profile: unknown, video: unknown, context: unknown): ScriptPromptComparisonResult {
  const adapted = prepareLegacyScriptPrompt(profile, video, context);
  if (!adapted.ok) {
    const problems = adapted.validation.errors.map((error) => finding("problem", error.code, error.message, error.field));
    return {
      ok: false,
      legacyPrompt: null,
      newPrompt: null,
      validation: adapted.validation,
      request: null,
      metadata: null,
      report: report({
        channelId: null, requestId: null, legacyMasterPromptVersion: null, masterPromptDigest: null,
        masterPromptPreserved: null, language: null, requestedWords: null, title: null, topic: null,
        targetAudience: null, narrationTone: null, storytellingStyle: null, additionalInstructions: null,
      }, [], [], problems),
    };
  }

  const { request, compiled, metadata } = adapted;
  // The exact master prompt is already snapshotted. The legacy builder uses the
  // same snapshotted content but applies its historical .trim() semantics.
  const master = request.masterPrompt.content;
  const legacyPrompt = buildStep0Question(master, request.title, request.topic, request.requestedWords);
  const newPrompt = compiled.promptText;
  const preserved = request.masterPrompt.content === (profile as Pick<ChannelProfile, "script">).script.masterPrompt;

  const expected = [
    finding("expected_difference", "subject_encoding", "Legacy uses plain title/topic labels; the new compiler encodes them as JSON reference data."),
    finding("expected_difference", "word_count_encoding", "Legacy expresses word count in a sentence; the new compiler uses a structured field when supplied."),
    finding("expected_difference", "output_format_rules", "The compilers use different narration-only output rules."),
    ...(master.trim() !== master
      ? [finding("expected_difference", "master_whitespace", "The legacy builder trims outer whitespace; the new compiler preserves the exact master prompt.")]
      : []),
  ];
  const warnings: ScriptComparisonFinding[] = [];
  if (request.language !== "")
    warnings.push(finding("warning", "legacy_language_implicit", "Legacy Step 0 does not append a dedicated language field; confirm the language is covered by channel instructions.", "language"));
  for (const [field, value] of [
    ["targetAudience", request.targetAudience],
    ["narrationTone", request.narrationTone],
    ["storytellingStyle", request.storytellingStyle],
    ["additionalInstructions", request.additionalInstructions],
  ] as const) {
    if (value !== "") warnings.push(finding("warning", "legacy_setting_not_explicit", `Legacy Step 0 does not append a separate ${field} field; the new prompt includes it.`, field));
  }
  const problems: ScriptComparisonFinding[] = [];
  if (!preserved) problems.push(finding("problem", "master_prompt_mismatch", "The snapshot does not match the supplied channel master prompt.", "masterPrompt"));

  const summary = report({
    channelId: request.channelId,
    requestId: request.requestId,
    legacyMasterPromptVersion: metadata.legacyMasterPromptVersion,
    masterPromptDigest: metadata.masterPromptDigest,
    masterPromptPreserved: preserved,
    language: request.language,
    requestedWords: request.requestedWords,
    title: request.title,
    topic: request.topic,
    targetAudience: request.targetAudience,
    narrationTone: request.narrationTone,
    storytellingStyle: request.storytellingStyle,
    additionalInstructions: request.additionalInstructions,
  }, expected, warnings, problems);

  // This should only be false for a corrupted/mutated external input. Never
  // deliver prompts when the channel/master identity fails its final check.
  if (problems.length) {
    return {
      ok: false, legacyPrompt: null, newPrompt: null, request: null, metadata: null,
      validation: { valid: false, errors: [{ field: "masterPrompt", code: "mismatch", message: problems[0]!.message }] },
      report: summary,
    };
  }

  return Object.freeze({
    ok: true, legacyPrompt, newPrompt, request, metadata, validation: adapted.validation, report: summary,
  });
}
