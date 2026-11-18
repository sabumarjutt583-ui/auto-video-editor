import test from "node:test";
import assert from "node:assert/strict";
import {nextLocalPartToPrepare} from "./nextPart.ts";
import type {ExecutionState} from "../execution/types.ts";
import type {ScriptStudioPlanV1} from "../studio/types.ts";
const plan={outlineRequired:false,continuityRequired:false} as ScriptStudioPlanV1;
function state(completed:number,total=8):ExecutionState{
 return {status:"active",completedParts:completed,totalParts:total,
  parts:Array.from({length:total},(_,i)=>({index:i+1,prepared:null})),
  outlineVersions:[],continuityNotes:[]} as unknown as ExecutionState;
}
test("SW-03L-TS-05 safe auto-prepare only selects a new local part",()=>{
 assert.equal(nextLocalPartToPrepare(state(1),plan),2);
 assert.equal(nextLocalPartToPrepare(state(4),plan),5);
 const s=state(4);s.parts[4].prepared={filename:"saved",bytes:1,sha256:"hash",createdAt:"now"};
 assert.equal(nextLocalPartToPrepare(s,plan),null);
});
test("SW-03L-TS-06 required outline and continuity must be saved first",()=>{
 const s=state(4);
 assert.equal(nextLocalPartToPrepare(s,{...plan,outlineRequired:true}),null);
 assert.equal(nextLocalPartToPrepare(s,{...plan,continuityRequired:true}),null);
 s.continuityNotes.push({afterPart:4,document:{filename:"note",bytes:1,sha256:"digest",createdAt:"now"}});
 assert.equal(nextLocalPartToPrepare(s,{...plan,continuityRequired:true}),5);
});
test("SW-03L-TS-07 single or completed executions never produce a next part",()=>{
 assert.equal(nextLocalPartToPrepare(state(1,1),plan),null);
 const finished=state(8);finished.status="assembled";
 assert.equal(nextLocalPartToPrepare(finished,plan),null);
});
