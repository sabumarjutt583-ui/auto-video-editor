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
