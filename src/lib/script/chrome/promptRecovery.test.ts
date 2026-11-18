import test from "node:test";
import assert from "node:assert/strict";
import {immutableRevision,pendingPromptKind} from "./promptRecovery.ts";
import type {PartState,ObjectRef} from "../execution/types.ts";
const ref=(r:number):ObjectRef=>({filename:"object-"+String(r).padStart(6,"0")+"-test.txt",bytes:1,sha256:"sha",createdAt:"today"});
function part():PartState{
 return {index:5,title:"Part 5",objective:"Continue",targetWords:100,prepared:ref(2),
  continuationPrompts:[],fragments:[],committed:null,actualWords:null,
  completedAt:null,validationFindings:[]};
}
test("SW-03L-ST-TS-03 original prompt is available for new unsent part",()=>{
 const p=part();
 assert.equal(pendingPromptKind(p),"prompt");
 assert.equal(immutableRevision(p.prepared),2);
});
test("SW-03L-ST-TS-04 imported fragment invalidates previously sent prompt",()=>{
 const p=part();p.fragments.push(ref(3));assert.equal(pendingPromptKind(p),null);
 p.continuationPrompts.push(ref(4));assert.equal(pendingPromptKind(p),"continuation");
 p.fragments.push(ref(5));assert.equal(pendingPromptKind(p),null);
 p.continuationPrompts.push(ref(6));assert.equal(pendingPromptKind(p),"continuation");
});
test("SW-03L-ST-TS-05 restart after part four preserves next part prompt",()=>{
 const p=part();assert.equal(pendingPromptKind(p),"prompt");
 p.committed=ref(8);assert.equal(pendingPromptKind(p),null);
 assert.equal(immutableRevision({filename:"bogus",bytes:1,sha256:"x",createdAt:""}),null);
});
