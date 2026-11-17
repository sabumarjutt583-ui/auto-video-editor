/** Phase 03I Rust execution model. Offline only; no provider account or browser authority. */
export interface ObjectRef {
  filename:string; bytes:number; sha256:string; createdAt:string;
}
export interface PartState {
  index:number;title:string;objective:string;targetWords:number;
  prepared:ObjectRef|null;continuationPrompts:ObjectRef[];fragments:ObjectRef[];
  committed:ObjectRef|null;actualWords:number|null;completedAt:string|null;
  validationFindings:string[];
}
export interface ContinuityNote {afterPart:number;document:ObjectRef}
export interface ExecutionState {
  schemaVersion:number;executionId:string;planId:string;channelId:string;
  planDigest:string;configDigest:string;createdAt:string;
  revision:number;previousDigest:string|null;operationId:string;operationDigest:string;
  status:"active"|"assembled"|"handoff_ready";currentPart:number;completedParts:number;totalParts:number;
  parts:PartState[];outlineVersions:ObjectRef[];bibleVersions:ObjectRef[];
  continuityNotes:ContinuityNote[];assembled:ObjectRef|null;assembledWords:number|null;
  handoff:ObjectRef|null;diagnostics:string[];
}
export interface ExecutionList {executions:ExecutionState[];issues:string[]}
export interface StartExecution {
  channelId:string;planId:string;executionId:string;operationId:string;
}
export type ExecutionAction =
  |{kind:"save_outline";text:string}
  |{kind:"save_bible";text:string}
  |{kind:"save_continuity";afterPart:number;text:string}
  |{kind:"prepare_part";partIndex:number;extraInstructions:string}
  |{kind:"import_fragment";partIndex:number;text:string}
  |{kind:"prepare_continuation";partIndex:number;extraInstructions:string}
  |{kind:"commit_part";partIndex:number;acceptWarnings:boolean}
  |{kind:"assemble"}
  |{kind:"prepare_handoff"};
export interface ExecutionRequest {
  channelId:string;executionId:string;expectedRevision:number;operationId:string;action:ExecutionAction;
}
export interface ExecutionError {code:string;message:string}
