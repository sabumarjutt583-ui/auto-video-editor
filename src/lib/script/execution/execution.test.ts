import assert from "node:assert/strict";
import { test } from "node:test";
import {buildExecutionRequest,errorDescription,newExecutionOperationId,newExecutionId} from "./api.ts";
import type { ExecutionAction,ExecutionState } from "./types.ts";
const session:ExecutionState={
  schemaVersion:1,executionId:"ex_test",planId:"sp_test",channelId:"channel_a",
  planDigest:"sha256:"+"a".repeat(64),configDigest:"sha256:"+"b".repeat(64),
  createdAt:"2026-11-17T00:00:00.000Z",revision:4,previousDigest:null,
  operationId:"op_test",operationDigest:"sha256:"+"c".repeat(64),
  status:"active",currentPart:2,completedParts:1,totalParts:8,
  parts:[],outlineVersions:[],bibleVersions:[],continuityNotes:[],
  assembled:null,assembledWords:null,handoff:null,diagnostics:[]
};
test("SW-03I-TS-01 typed immutable operation snapshots bind channel and revision",()=>{
  const operation:ExecutionAction={kind:"prepare_part",partIndex:2,extraInstructions:"Keep name Amir"};
  const request=buildExecutionRequest(session,operation,"op_stable");
  assert.deepEqual(request,{channelId:"channel_a",executionId:"ex_test",expectedRevision:4,
    operationId:"op_stable",action:operation});
  assert.equal(request.action.kind,"prepare_part");
  assert.equal(request.action.kind==="prepare_part"&&request.action.extraInstructions,"Keep name Amir");
});
test("SW-03I-TS-02 manual Unicode import payload is not normalized or trimmed",()=>{
  const original="  اردو 한국어 🧠 \r\nhello\t\n";
  const request=buildExecutionRequest(session,{kind:"import_fragment",partIndex:2,text:original},"op_unicode");
  assert.equal(request.action.kind,"import_fragment");
  if(request.action.kind!=="import_fragment")throw Error("unexpected action");
  assert.equal(request.action.text,original);
  assert.equal(JSON.parse(JSON.stringify(request)).action.text,original);
});
test("SW-03I-TS-03 distinct execution and operation IDs are namespaced",()=>{
  assert.match(newExecutionId(),/^ex_[a-f0-9]{32}$/);
  assert.match(newExecutionOperationId(),/^exec_[a-f0-9]{32}$/);
  assert.notEqual(newExecutionId(),newExecutionId());
});
test("SW-03I-TS-04 safe local error classification does not invent success",()=>{
  assert.match(errorDescription({code:"stale_revision",message:"reload"}),/stale_revision: reload/);
  assert.match(errorDescription("untrusted message"),/Offline execution failed/);
});
test("SW-03I-TS-05 strongly typed continuation request preserves explicit part ownership",()=>{
  const operation:ExecutionAction={kind:"prepare_continuation",partIndex:2,extraInstructions:"Continue from last complete sentence"};
  const request=buildExecutionRequest(session,operation,"op_continue");
  assert.equal(request.executionId,session.executionId);
  assert.equal(request.expectedRevision,4);
  assert.equal(request.action.kind,"prepare_continuation");
});
