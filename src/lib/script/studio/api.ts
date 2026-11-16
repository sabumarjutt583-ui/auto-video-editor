import { invoke } from "@tauri-apps/api/core";
import type { ChannelProfile } from "../../pipeline/profile.ts";
import type {
  ChannelStudioConfigV1, LegacyChannelSeed, StudioEdit, StudioPlanList,
  PlanInput, ScriptStudioPlanV1, StudioPreview, StudioBackupV1,
  StudioCommandError, StudioErrorCode, StudioAccountMetadata,
} from "./types.ts";

/** The existing saved profile ID—not a provider account or a new identity namespace. */
export function seedFromProfile(profile: ChannelProfile): LegacyChannelSeed {
  return {
    channelId: profile.id, channelName: profile.name, language: profile.language,
    masterPrompt: profile.script.masterPrompt, claudeAccountId: profile.script.claudeAccountId ?? null,
  };
}
export function studioOperationId(prefix = "op"): string {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "");
}
export function studioPlanId(): string {
  return studioOperationId("sp");
}
export function buildStudioEdit(config: ChannelStudioConfigV1, operationId: string, edits: {
  newMasterPrompt?: string | null;
  newReviewPrompt?: string | null;
  newMasterPlanning?: StudioEdit["newMasterPlanning"];
  newReviewPlanning?: StudioEdit["newReviewPlanning"];
} = {}): StudioEdit {
  return {
    channelId: config.channelId, expectedRevision: config.revision, operationId,
    channelName: config.channelName, writing: config.writing,
    accounts: config.accounts, review: config.review, rubric: config.rubric,
    planning: config.planning, skills: config.skills,
    newMasterPrompt: edits.newMasterPrompt ?? null,
    newReviewPrompt: edits.newReviewPrompt ?? null,
    selectMasterVersionId: config.selectedPromptVersionId,
    selectReviewVersionId: config.selectedReviewVersionId,
    newMasterPlanning: edits.newMasterPlanning ?? null,
    newReviewPlanning: edits.newReviewPlanning ?? null,
  };
}
export const getStudioConfig = (seed: LegacyChannelSeed): Promise<ChannelStudioConfigV1> =>
  invoke("studio_get", {seed});
export const saveStudioConfig = (seed: LegacyChannelSeed, edit: StudioEdit): Promise<ChannelStudioConfigV1> =>
  invoke("studio_save", {seed, edit});
export const getStudioHistory = (seed: LegacyChannelSeed): Promise<ChannelStudioConfigV1[]> =>
  invoke("studio_history", {seed});
export const previewStudioPlan = (seed: LegacyChannelSeed, input: PlanInput): Promise<StudioPreview> =>
  invoke("studio_preview_plan", {seed,input});
export const saveStudioPlan = (seed: LegacyChannelSeed, input: PlanInput): Promise<ScriptStudioPlanV1> =>
  invoke("studio_save_plan", {seed,input});
export const getStudioPlan = (channelId: string, planId: string): Promise<ScriptStudioPlanV1> =>
  invoke("studio_get_plan", { input: { channelId, planId } });
export const listStudioPlans = (channelId: string): Promise<StudioPlanList> =>
  invoke("studio_list_plans", {channelId});
export const exportStudioConfig = (seed: LegacyChannelSeed): Promise<StudioBackupV1> =>
  invoke("studio_export", {seed});
export const importStudioConfig = (seed: LegacyChannelSeed, backup: StudioBackupV1, operationId: string): Promise<ChannelStudioConfigV1> =>
  invoke("studio_import", {seed,backup,operationId});
/** Existing account managers; list metadata only, never credentials or sessions. */
export const listStudioClaudeAccounts = (): Promise<StudioAccountMetadata[]> =>
  invoke("script_accounts");
export const listStudioChatGptAccounts = (): Promise<StudioAccountMetadata[]> =>
  invoke("chatgpt_accounts");

const known: readonly StudioErrorCode[] = [
  "invalid_input","invalid_account","channel_mismatch","not_found","conflict",
  "stale_revision","history_full","writer_busy","storage_failure",
  "corrupt_record","unsupported_version","recovery_blocked",
];
export function parseStudioError(error: unknown): StudioCommandError | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const value = error as {code?: unknown;message?: unknown};
  return typeof value.code === "string" && known.includes(value.code as StudioErrorCode)
    && typeof value.message === "string"
    ? {code:value.code as StudioErrorCode,message:value.message}:null;
}
