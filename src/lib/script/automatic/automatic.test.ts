import test from "node:test";
import assert from "node:assert/strict";
import {automaticProgress,type AutoView} from "./api.ts";
test("SW-03M-TS-01 fixture status never claims actual AI or fake percentage",()=>{
 const v={execution:{completedParts:4,totalParts:10},review:null,workerRunning:true,
  task:{stage:"part_committed"}} as AutoView;
 assert.equal(automaticProgress(v),"4/10 parts · active MOCK worker");
 assert.equal(automaticProgress({...v,workerRunning:false}),"4/10 parts · stopped");
});
test("SW-03M-TS-02 final task requires human approval",()=>{
 const v={execution:{completedParts:1,totalParts:1},review:null,workerRunning:false,
 task:{stage:"awaiting_approval"}} as AutoView;
 assert.match(automaticProgress(v),/pending human approval/);
});
