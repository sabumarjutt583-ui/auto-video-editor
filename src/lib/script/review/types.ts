/** Phase 03J offline Rust-owned review contracts. All scores are manually reported, never generated. */
import type { RubricCriterion } from "../studio/types.ts";
export interface ReviewObject {filename:string;bytes:number;sha256:string;createdAt:string}
export interface CategoryScore {key:string;points:number}
export type Severity = "info"|"warning"|"error";
export interface Finding {severity:Severity;category:string;summary:string;recommendation:string}
export interface Report {scores:CategoryScore[];findings:Finding[];summary:string}
export interface ReviewPolicy {
 provider:"none"|"claude"|"chatgpt";accountRef:string|null;promptVersion:string|null;
 promptDigest:string|null;promptText:string;rubric:RubricCriterion[];
 audience:string;tone:string;style:string;language:string;
 singleInstructions:string;perPartInstructions:string;finalInstructions:string;
 title:string;topic:string;partObjective:string|null;targetWords:number|null;
}
export interface ScriptVersion {index:number;text:ReviewObject;source:string;parentDigest:string|null;
 improvementPrompt:ReviewObject|null;validationFindings:string[]}
export interface SectionReview {index:number;bytes:number;prompt:ReviewObject;raw:ReviewObject|null;
 report:Report|null;score:number|null;validationIssues:string[]}
export interface ReviewRound {index:number;versionIndex:number;mode:string;createdAt:string;sections:SectionReview[]}
export interface Approval {versionIndex:number;scriptDigest:string;roundIndex:number;
 reviewDigest:string;confirmedAt:string;confirmation:string;provenance:string}
export interface ReviewState {schemaVersion:number;reviewId:string;channelId:string;executionId:string;
 planId:string;planDigest:string;sourceDigest:string;sourceExecutionRevision:number;
 partIndex:number|null;createdAt:string;policy:ReviewPolicy;
 revision:number;previousDigest:string|null;operationId:string;operationDigest:string;
 versions:ScriptVersion[];rounds:ReviewRound[];approvals:Approval[]}
export interface ReviewList {reviews:ReviewState[];issues:string[]}
export interface StartReview {channelId:string;executionId:string;reviewId:string;
 partIndex:number|null;operationId:string}
export type ReviewAction=
 |{kind:"import_response";sectionIndex:number;raw:string}
 |{kind:"correct_response";sectionIndex:number;report:Report}
 |{kind:"prepare_improvement";goals:string[]}
 |{kind:"import_revision";text:string}
 |{kind:"prepare_review";mode:"single"|"part"|"final"|"continuity"|"improvement"}
 |{kind:"approve";confirmation:string};
export interface ReviewRequest {channelId:string;reviewId:string;expectedRevision:number;
 operationId:string;action:ReviewAction}
