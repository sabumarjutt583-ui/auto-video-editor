import assert from "node:assert/strict";
import {test} from "node:test";
import {buildReviewRequest,hasFullCoverage,isCurrentApproved,newReviewId,newReviewOperation,sumScore} from "./api.ts";
import type {ReviewState,ReviewPolicy} from "./types.ts";
const h="sha256:"+"a".repeat(64);
const policy:ReviewPolicy={
 provider:"none",accountRef:null,promptVersion:null,promptDigest:null,promptText:"",
 rubric:[{key:"hook",label:"Hook",points:70},{key:"clarity",label:"Clarity",points:30}],
 audience:"US adults",tone:"clear",style:"documentary",language:"English",
 singleInstructions:"",perPartInstructions:"",finalInstructions:"",
 title:"Example",topic:"Example",partObjective:null,targetWords:null
};
const artifact={filename:"object-000000-script-v0.txt",bytes:20,sha256:h,createdAt:"2026-11-17T00:00:00.000Z"};
const base:ReviewState={
 schemaVersion:1,reviewId:"rv_a",channelId:"channel_a",executionId:"ex_a",planId:"sp_a",
 planDigest:h,sourceDigest:h,sourceExecutionRevision:4,partIndex:null,
 createdAt:"2026-11-17T00:00:00.000Z",policy,revision:8,previousDigest:null,
 operationId:"op_a",operationDigest:h,
 versions:[{index:0,text:artifact,source:"manual",parentDigest:null,improvementPrompt:null,validationFindings:[]}],
 rounds:[{index:0,versionIndex:0,mode:"final",createdAt:"2026-11-17T00:00:00.000Z",sections:[
  {index:0,bytes:20,prompt:artifact,raw:null,report:null,score:null,validationIssues:[]}
 ]}],approvals:[]
};
test("SW-03J-TS-01 revision and channel are bound in review operation",()=>{
 const action={kind:"import_response" as const,sectionIndex:0,raw:"  اردو 한국어 😀 \r\n"};
 const request=buildReviewRequest(base,action,"op_fixed");
 assert.equal(request.channelId,"channel_a");assert.equal(request.reviewId,"rv_a");
 assert.equal(request.expectedRevision,8);assert.equal(request.action.kind,"import_response");
 assert.equal(JSON.parse(JSON.stringify(request)).action.raw,action.raw);
});
test("SW-03J-TS-02 partial sections never claim full coverage or score",()=>{
 assert.equal(hasFullCoverage(base),false);assert.equal(sumScore(base),null);
 const s=structuredClone(base);
 s.rounds[0].sections.push({...s.rounds[0].sections[0],index:1});
 s.rounds[0].sections[0].report={scores:[{key:"hook",points:50},{key:"clarity",points:28}],findings:[],summary:"Manual review"};
 s.rounds[0].sections[0].score=78;
 assert.equal(hasFullCoverage(s),false);assert.equal(sumScore(s),null);
 s.rounds[0].sections[1].report=s.rounds[0].sections[0].report;
 s.rounds[0].sections[1].score=78;
 assert.equal(hasFullCoverage(s),true);
 assert.equal(sumScore(s),null); // No invented overall score for multiple section reviews.
});
test("SW-03J-TS-03 approval is tied to digest of current version",()=>{
 const s=structuredClone(base);
 s.rounds[0].sections[0].report={scores:[{key:"hook",points:70},{key:"clarity",points:30}],
   findings:[],summary:"Explicitly imported manual review"};
 s.rounds[0].sections[0].score=100;
 s.approvals.push({versionIndex:0,scriptDigest:h,roundIndex:0,reviewDigest:h,
 confirmedAt:"2026-11-17T00:00:00.000Z",confirmation:"APPROVE FINAL SCRIPT",
 provenance:"explicit_local_user_confirmation"});
 assert.equal(isCurrentApproved(s),true);
 s.versions.push({...s.versions[0],index:1,text:{...artifact,sha256:"sha256:"+"b".repeat(64)}});
 assert.equal(isCurrentApproved(s),false);
});
test("SW-03J-TS-04 namespaced IDs and stable operation retries",()=>{
 assert.match(newReviewId(),/^rv_[0-9a-f]{32}$/);
 assert.match(newReviewOperation(),/^review_[0-9a-f]{32}$/);
 const first=buildReviewRequest(base,{kind:"approve",confirmation:"APPROVE FINAL SCRIPT"},"op_same");
 assert.deepEqual(first,buildReviewRequest(base,first.action,"op_same"));
});

test("SW-03J-STAB-TS-01 invalid or partial historical approval is not displayed as current",()=>{
 const state=structuredClone(base);
 state.approvals.push({versionIndex:0,scriptDigest:h,roundIndex:0,reviewDigest:h,
  confirmedAt:"2026-11-17T00:00:00.000Z",confirmation:"APPROVE FINAL SCRIPT",
  provenance:"explicit_local_user_confirmation"});
 assert.equal(isCurrentApproved(state),false,"missing structured review");
 state.rounds[0].sections[0].report={scores:[{key:"hook",points:60},{key:"clarity",points:20}],
  findings:[],summary:"Manual"};
 state.rounds[0].sections[0].score=80;
 assert.equal(isCurrentApproved(state),true);
 state.approvals[0].scriptDigest="sha256:stale";
 assert.equal(isCurrentApproved(state),false);
 state.approvals[0].scriptDigest=h;
 state.approvals[0].roundIndex=777;
 assert.equal(isCurrentApproved(state),false);
});
test("SW-03J-STAB-TS-02 scoped coverage is not a holistic aggregate",()=>{
 const s=structuredClone(base);
 s.rounds[0].sections=[{...s.rounds[0].sections[0],index:0,bytes:8,
  coverage:{startByte:0,endByte:8,sha256:"sha256:a"}},
  {...s.rounds[0].sections[0],index:1,bytes:12,
   coverage:{startByte:8,endByte:20,sha256:"sha256:b"}}];
 const report={scores:[{key:"hook",points:60},{key:"clarity",points:20}],
  findings:[],summary:"User-reported reviewer feedback"};
 s.rounds[0].sections[0].score=80;s.rounds[0].sections[0].report=report;
 assert.equal(hasFullCoverage(s),false);assert.equal(sumScore(s),null);
 s.rounds[0].sections[1].score=90;s.rounds[0].sections[1].report=report;
 assert.equal(hasFullCoverage(s),true);
 assert.equal(sumScore(s),null,"section scores must not be averaged");
});
test("SW-03J-STAB-TS-03 immutable execution continuity context serializes exact Urdu and CRLF",()=>{
 const s=structuredClone(base);
 s.policy.continuity={executionRevision:5,sourceCount:1,includedBytes:0,omittedCount:0,
  entries:[{kind:"continuity",afterPart:1,sourceSha256:h,sourceBytes:0,
   includedText:"  کردار: Amir اردو 한국어 😀\r\n"}],
  partStructure:[{partIndex:1,title:"Start",objective:"Maintain Amir",targetWords:100,
   previousPart:null,nextPart:2},{partIndex:2,title:"Finish",objective:"Continue Amir",targetWords:100,
   previousPart:1,nextPart:null}],
  warnings:[]};
 const text=s.policy.continuity.entries[0].includedText;
 const decoded=JSON.parse(JSON.stringify(s)) as ReviewState;
 assert.equal(decoded.policy.continuity?.entries[0].includedText,text);
 assert.equal(decoded.policy.continuity?.partStructure[1].previousPart,1);
 assert.equal(decoded.policy.continuity?.sourceCount,1);
});
test("SW-03J-STAB-TS-04 failed operation data can be retried with exact payload and revision",()=>{
 const raw="  {\r\n  bad: Urdu اردو 😀  ";
 const importAction={kind:"import_response" as const,sectionIndex:0,raw};
 const first=buildReviewRequest(base,importAction,"op_repeat");
 assert.equal(first.expectedRevision,base.revision);
 assert.equal(JSON.parse(JSON.stringify(first)).action.raw,raw);
 const retry=buildReviewRequest(base,importAction,"op_repeat");
 assert.deepEqual(first,retry);
 assert.equal(first.channelId,base.channelId);
});
test("SW-03J-STAB-TS-05 correction is separate from raw and cannot imply approval",()=>{
 const state=structuredClone(base);
 const raw="  Reviewer wrote incomplete notes\r\n";
 const imported=buildReviewRequest(state,{kind:"import_response",sectionIndex:0,raw},"op_import");
 const correction=buildReviewRequest(state,{kind:"correct_response",sectionIndex:0,report:{
  scores:[{key:"hook",points:70},{key:"clarity",points:30}],findings:[],summary:"Manual correction"}
 },"op_correct");
 assert.equal((imported.action as {raw:string}).raw,raw);
 assert.equal(correction.action.kind,"correct_response");
 assert.equal(isCurrentApproved(state),false);
});
