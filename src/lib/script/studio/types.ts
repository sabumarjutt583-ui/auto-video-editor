/** Mirrors src-tauri/src/script_studio/model.rs. Never contains browser tokens or credentials. */
export type WritingMode = "master_prompt" | "claude_skill" | "master_plus_skill";
export type ScriptMode = "single" | "multi_part";
export type AccountPolicy = "strict_selected" | "automatic_permitted";
export type ReviewerProvider = "none" | "claude" | "chatgpt";
export type SkillInstallStatus = "registered_locally" | "user_confirmed_installed" | "needs_attention";

export interface PlanningDefaults {
  defaultScriptMode: ScriptMode;
  defaultPartCount: number;
  defaultTotalWords: number;
  targetWordsPerPart: number | null;
  outlineRequired: boolean;
  continuityRequired: boolean;
}
export type PlanningOverride = Partial<PlanningDefaults>;
export interface TextVersion {
  versionId: string;
  channelId: string;
  content: string;
  contentDigest: string;
  createdAt: string;
  planningOverride: PlanningOverride | null;
}
export interface SkillRegistration {
  skillId: string;
  channelId: string;
  displayName: string;
  exactName: string;
  claudeAccountId: string;
  description: string;
  status: SkillInstallStatus;
  userConfirmedAt: string | null;
  planningOverride: PlanningOverride | null;
}
export interface AccountPreferences {
  claudeAccountId: string | null;
  chatgptReviewAccountId: string | null;
  writerPolicy: AccountPolicy;
  reviewerPolicy: AccountPolicy;
  allowedClaudeAccountIds: string[];
  allowedChatgptAccountIds: string[];
}
export interface RubricCriterion {
  key: string;
  label: string;
  points: number;
}
export interface WritingSettings {
  instructionMode: WritingMode;
  selectedSkillId: string | null;
  language: string;
  targetAudience: string;
  narrationTone: string;
  writingStyle: string;
  additionalInstructions: string;
  defaultWordTarget: number;
}
export interface ReviewSettings {
  provider: ReviewerProvider;
  requireUserApproval: boolean;
  singleScriptInstructions: string;
  perPartInstructions: string;
  finalScriptInstructions: string;
}
export interface ChannelStudioConfigV1 {
  schemaVersion: 1;
  channelId: string;
  channelName: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  previousDigest: string | null;
  operationId: string | null;
  operationDigest: string | null;
  promptVersions: TextVersion[];
  selectedPromptVersionId: string | null;
  reviewVersions: TextVersion[];
  selectedReviewVersionId: string | null;
  skills: SkillRegistration[];
  writing: WritingSettings;
  accounts: AccountPreferences;
  review: ReviewSettings;
  rubric: RubricCriterion[];
  planning: PlanningDefaults;
}
export interface LegacyChannelSeed {
  channelId: string;
  channelName: string;
  language: string;
  masterPrompt: string;
  claudeAccountId: string | null;
}
export interface StudioEdit {
  channelId: string;
  expectedRevision: number;
  operationId: string;
  channelName: string;
  writing: WritingSettings;
  accounts: AccountPreferences;
  review: ReviewSettings;
  rubric: RubricCriterion[];
  planning: PlanningDefaults;
  skills: SkillRegistration[];
  newMasterPrompt: string | null;
  selectMasterVersionId: string | null;
  newReviewPrompt: string | null;
  selectReviewVersionId: string | null;
  newMasterPlanning: PlanningOverride | null;
  newReviewPlanning: PlanningOverride | null;
}
export interface PartRequest {
  title: string;
  objective: string;
  overrideWords: number | null;
}
export interface PlanInput {
  planId: string;
  channelId: string;
  expectedConfigRevision: number;
  title: string;
  topic: string;
  language: string | null;
  mode: ScriptMode | null;
  totalWords: number | null;
  partCount: number | null;
  outlineRequired: boolean | null;
  continuityRequired: boolean | null;
  parts: PartRequest[];
}
export interface ScriptPlanPart {
  index: number;
  title: string;
  objective: string;
  targetWords: number;
}
export interface ScriptStudioPlanV1 {
  schemaVersion: 1;
  planId: string;
  channelId: string;
  configRevision: number;
  configDigest: string;
  createdAt: string;
  title: string;
  topic: string;
  language: string;
  writingMode: WritingMode;
  selectedPromptVersionId: string | null;
  selectedPromptDigest: string | null;
  selectedSkillId: string | null;
  selectedSkillName: string | null;
  claudeAccountId: string | null;
  reviewerProvider: ReviewerProvider;
  reviewerAccountId: string | null;
  reviewerPromptVersionId: string | null;
  reviewerPromptDigest: string | null;
  mode: ScriptMode;
  totalWords: number;
  partCount: number;
  outlineRequired: boolean;
  continuityRequired: boolean;
  parts: ScriptPlanPart[];
  configSnapshot: ChannelStudioConfigV1;
  warnings: string[];
}
export interface StudioPreview {
  plan: ScriptStudioPlanV1;
  writingPreview: string;
  reviewPreview: string;
}
export interface StudioPlanList {
  plans: ScriptStudioPlanV1[];
  issues: string[];
}
export interface StudioBackupV1 {
  backupVersion: 1;
  sourceChannelId: string;
  config: ChannelStudioConfigV1;
}
export type StudioErrorCode =
  | "invalid_input" | "invalid_account" | "channel_mismatch" | "not_found"
  | "conflict" | "stale_revision" | "history_full" | "writer_busy"
  | "storage_failure" | "corrupt_record" | "unsupported_version" | "recovery_blocked";
export interface StudioCommandError { code: StudioErrorCode; message: string; }
export interface StudioAccountMetadata {id:string;name:string}
