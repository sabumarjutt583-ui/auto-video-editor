import test from "node:test";
import assert from "node:assert/strict";
import {accountSummary,responseStats} from "./api.ts";
import type {ChromeAccountReport} from "./api.ts";
const fixture:ChromeAccountReport={provider:"claude",accountId:"1",displayName:"Claude 1",
 profileIdentity:"claude:1",savedAccountPresent:true,lastReportedConnected:false,
 signingIn:false,reportedAccountError:"",processState:"not_observed_after_app_restart",
 lastLaunchError:"",authenticationVerified:false,canFocus:false,canCloseSafely:false};
test("SW-03L-TS-01 process reporting never claims login or opened browser",()=>{
 assert.match(accountSummary(fixture),/still be open/);
 assert.equal(fixture.authenticationVerified,false);
 assert.match(accountSummary({...fixture,processState:"process_running_window_not_verified"}),/not verified/);
});
test("SW-03L-TS-02 missing account and failed launch avoid fallback",()=>{
 assert.match(accountSummary({...fixture,savedAccountPresent:false}),/do not open a fallback/);
 assert.match(accountSummary({...fixture,processState:"launch_failed"}),/preserved/);
});
test("SW-03L-TS-03 exact raw response statistics preserve Unicode and CRLF",()=>{
 const raw="  Hello\r\nاردو 😀\r\n끝  ";
 assert.deepEqual(responseStats(raw),{words:4,lines:3,bytes:new TextEncoder().encode(raw).length});
 assert.equal(raw.split("\r\n").length,3);
});
test("SW-03L-TS-04 two providers never share a logical profile identifier",()=>{
 assert.notEqual(fixture.profileIdentity,"chatgpt:1");
});
