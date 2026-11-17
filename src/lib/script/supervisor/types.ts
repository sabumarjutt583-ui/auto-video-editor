import type {ScriptStudioPlanV1} from "../studio/types.ts";
export type SupervisorTransport="visible_browser"|"local_mock"|"authorized_api";
export type TaskStage="created"|"resolving_configuration"|"awaiting_login"|"browser_opening"|
 "awaiting_user_action"|"prompt_prepared"|"submission_uncertain"|"awaiting_response"|
 "response_imported"|"response_validated"|"part_committed"|"review_pending"|
 "review_imported"|"improvement_pending"|"awaiting_approval"|"completed"|
 "paused"|"cancelled"|"failed";
export interface SupervisorSnapshot {
 plan:ScriptStudioPlanV1;planSha256:string;executionId:string;
 writerAccountId:string|null;reviewerAccountId:string|null;
 reviewerProvider:string;selectedSkillId:string|null;selectedSkillName:string|null;
 skillStatus:string;transport:SupervisorTransport;capabilities:string[];
}
export interface SupervisorTask {
 schemaVersion:1;taskId:string;channelId:string;revision:number;previousDigest:string|null;
 operationId:string;operationDigest:string;snapshot:SupervisorSnapshot;
 stage:TaskStage;resumeStage:TaskStage|null;lastExecutionRevision:number;
 lastExecutionDigest:string;completedParts:number;totalParts:number;
 lastReviewId:string|null;lastReviewRevision:number|null;
 reviewedSections:number;totalSections:number;approvalDigest:string|null;
 warnings:string[];events:string[];
}
export interface TaskStart {
 channelId:string;taskId:string;executionId:string;operationId:string;
 writerAccountId:string|null;reviewerAccountId:string|null;
 skillStatus:string;transport:SupervisorTransport;
}
export type SupervisorAction =
 |{kind:"prepare_prompt"}|{kind:"mark_browser_opening"}|{kind:"mark_browser_opened"}
 |{kind:"mark_login_required"}|{kind:"mark_user_handoff"}
 |{kind:"mark_submission_uncertain"}|{kind:"mark_awaiting_response"}
 |{kind:"pause"}|{kind:"resume"}|{kind:"cancel"}
 |{kind:"sync_execution"}|{kind:"sync_review";reviewId:string}
 |{kind:"inspect_approval";reviewId:string};
export interface TaskRequest{channelId:string;taskId:string;expectedRevision:number;
 operationId:string;action:SupervisorAction}
export type MockScenario="complete"|"partial"|"provider_failure"|"connection_lost"|
 "submission_uncertain"|"too_large"|"invalid_review";
export interface MockResult{status:string;provenance:string;text:string|null;issue:string|null}
