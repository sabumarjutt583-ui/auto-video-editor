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

test("SW-03M-TS-03 unresolved MOCK review target is explicit",()=>{
 const v={execution:{completedParts:1,totalParts:1},policy:{reviewTarget:90},
  workerRunning:false,task:{stage:"awaiting_approval"},
  review:{rounds:[{sections:[{score:60,report:{summary:"MOCK"}}]}]}} as AutoView;
 assert.match(automaticProgress(v),/review target unmet/);
 assert.match(automaticProgress(v),/pending human approval/);
});
test("SW-03M-TS-04 mock scores at threshold do not report unmet target",()=>{
 const v={execution:{completedParts:10,totalParts:10},policy:{reviewTarget:90},
  workerRunning:false,task:{stage:"awaiting_approval"},
  review:{rounds:[{sections:[{score:92,report:{summary:"MOCK"}}]}]}} as AutoView;
 assert.doesNotMatch(automaticProgress(v),/target unmet/);
});
