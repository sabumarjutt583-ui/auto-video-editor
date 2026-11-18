import test from "node:test";
import assert from "node:assert/strict";
import type {AutoView} from "./api.ts";
import {canApproveExact,currentVersionApproved} from "./approval.ts";
const oldDigest="a".repeat(64),latestDigest="b".repeat(64);
const view=():AutoView=>({workerRunning:false,task:{stage:"awaiting_approval"},
 review:{versions:[{index:0,text:{sha256:oldDigest}},{index:1,text:{sha256:latestDigest}}],
  rounds:[{index:2,versionIndex:1,sections:[{score:95,report:{summary:"MOCK"}}]}],
  approvals:[{versionIndex:0,scriptDigest:oldDigest,roundIndex:0}]}} as AutoView);
test("SW-03M-ST-TS-01 old approval cannot authorize the newest revision",()=>{
 const v=view();
 assert.equal(currentVersionApproved(v),false);
 assert.equal(canApproveExact(v,oldDigest),false);
 assert.equal(canApproveExact(v,latestDigest),true);
});
test("SW-03M-ST-TS-02 require exact preview and fully reviewed current version",()=>{
 const v=view();
 assert.equal(canApproveExact(v,""),false);
 assert.equal(canApproveExact({...v,workerRunning:true},latestDigest),false);
 assert.equal(canApproveExact({...v,review:{...v.review!,rounds:[{...v.review!.rounds[0],sections:[{...v.review!.rounds[0].sections[0],score:null,report:null}]}]}},latestDigest),false);
 const approved=view();
 approved.review!.approvals.push({versionIndex:1,scriptDigest:latestDigest,roundIndex:2,
   reviewDigest:"saved",confirmedAt:"now",confirmation:"APPROVE FINAL SCRIPT",
   provenance:"explicit_local_user_confirmation"});
 assert.equal(currentVersionApproved(approved),true);
 assert.equal(canApproveExact(approved,latestDigest),false);
});
