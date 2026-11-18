import test from "node:test";
import assert from "node:assert/strict";
import {operatorCanEdit,selectReviewSection} from "./operator.ts";
test("SW-03L-ST-TS-01 no paused or terminal source mutations",()=>{
 for(const stage of ["paused","cancelled","completed","failed"] as const)assert.equal(operatorCanEdit(stage),false);
 assert.equal(operatorCanEdit("part_committed"),true);
});
test("SW-03L-ST-TS-02 preserve review selection only within matching round",()=>{
 const x={reviewId:"rv_a",round:2,index:3};
 assert.equal(selectReviewSection(x,"rv_a",2,8),3);
 assert.equal(selectReviewSection(x,"rv_a",3,8),0);
 assert.equal(selectReviewSection(x,"rv_b",2,8),0);
 assert.equal(selectReviewSection(x,"rv_a",2,2),0);
});
