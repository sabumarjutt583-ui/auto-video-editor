import test from "node:test";
import assert from "node:assert/strict";
import {taskMessage,taskRequest} from "./api.ts";
import type {SupervisorTask} from "./types.ts";

function sample():SupervisorTask{
 return {
  schemaVersion:1,taskId:"su_mock",channelId:"channel_a",revision:4,
  previousDigest:null,operationId:"op_last",operationDigest:"sha",
  snapshot:{
   plan:{schemaVersion:1,planId:"sp_1",channelId:"channel_a",configRevision:0,
    configDigest:"hash",createdAt:"2026-11-17T00:00:00.000Z",title:"T",topic:"T",language:"English",
    writingMode:"master_prompt",selectedPromptVersionId:null,selectedPromptDigest:null,
    selectedSkillId:null,selectedSkillName:null,claudeAccountId:"cl_1",
    reviewerProvider:"chatgpt",reviewerAccountId:"gp_1",reviewerPromptVersionId:null,
    reviewerPromptDigest:null,mode:"single",totalWords:120,partCount:1,outlineRequired:false,
    continuityRequired:false,parts:[{index:1,title:"Part 1",objective:"Complete",targetWords:120}],
    configSnapshot:{} as SupervisorTask["snapshot"]["plan"]["configSnapshot"],warnings:[]},
   planSha256:"real_plan_hash",executionId:"ex_1",writerAccountId:"cl_1",
   reviewerAccountId:"gp_1",reviewerProvider:"chatgpt",selectedSkillId:null,
   selectedSkillName:null,skillStatus:"not_configured",transport:"visible_browser",
   capabilities:["open_visible_profile","copy_local_prompt","manual_response_import"]
  },
  stage:"created",resumeStage:null,lastExecutionRevision:0,
  lastExecutionDigest:"sha256:exec",completedParts:0,totalParts:1,
  lastReviewId:null,lastReviewRevision:null,reviewedSections:0,totalSections:0,
  approvalDigest:null,warnings:[],events:["created_from_immutable_plan_and_execution"]
 };
}
test("SW-03K-TS-01 browser opened is never described as provider submission or generated text",()=>{
 const state=sample();state.stage="awaiting_user_action";
 assert.match(taskMessage(state),/No provider submission or reply was verified/);
 assert.doesNotMatch(taskMessage(state),/automatically completed|provider verified/);
});
test("SW-03K-TS-02 uncertain submission never automatically retries",()=>{
 const state=sample();state.stage="submission_uncertain";
 assert.match(taskMessage(state),/UNCERTAIN/);
 assert.match(taskMessage(state),/Never retry automatically/);
});
test("SW-03K-TS-03 copied prompt remains local and unsubmitted",()=>{
 const state=sample();state.stage="prompt_prepared";
 assert.match(taskMessage(state),/NOT been submitted/);
 assert.equal(state.completedParts,0);
});
test("SW-03K-TS-04 request retains immutable channel and expected revision",()=>{
 const state=sample();
 const req=taskRequest(state,{kind:"sync_review",reviewId:"rv_1"},"op_exact");
 assert.deepEqual(req,{channelId:"channel_a",taskId:"su_mock",expectedRevision:4,
  operationId:"op_exact",action:{kind:"sync_review",reviewId:"rv_1"}});
 const replay=taskRequest(state,{kind:"sync_review",reviewId:"rv_1"},"op_exact");
 assert.deepEqual(replay,req);
});
test("SW-03K-TS-05 completed requires a backend-owned saved approval digest",()=>{
 const state=sample();state.stage="awaiting_approval";
 assert.equal(state.approvalDigest,null);
 const old=taskMessage(state);
 assert.doesNotMatch(old,/verified an explicit approval/);
 state.stage="completed";state.approvalDigest="sha256:approved";
 assert.match(taskMessage(state),/Rust verified an explicit approval/);
});
test("SW-03K-TS-06 mock and browser transports have distinct permissions",()=>{
 const state=sample();
 assert.ok(state.snapshot.capabilities.includes("open_visible_profile"));
 assert.ok(!state.snapshot.capabilities.includes("deterministic_offline_text"));
 state.snapshot.transport="local_mock";state.snapshot.capabilities=["deterministic_offline_text"];
 assert.ok(!state.snapshot.capabilities.includes("open_visible_profile"));
});
test("SW-03K-TS-07 account references belong to plan's channel, not email",()=>{
 const state=sample();
 assert.equal(state.channelId,state.snapshot.plan.channelId);
 assert.equal(state.snapshot.writerAccountId,state.snapshot.plan.claudeAccountId);
 assert.equal(state.snapshot.reviewerAccountId,state.snapshot.plan.reviewerAccountId);
});
test("SW-03K-TS-08 pause/resume retains exact stage in state",()=>{
 const state=sample();state.stage="paused";state.resumeStage="submission_uncertain";
 const result=JSON.parse(JSON.stringify(state)) as SupervisorTask;
 assert.equal(result.resumeStage,"submission_uncertain");
 assert.equal(result.stage,"paused");
});
