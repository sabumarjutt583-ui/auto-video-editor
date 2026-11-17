import {invoke} from "@tauri-apps/api/core";
import type {LegacyChannelSeed} from "../studio/types.ts";
import {studioOperationId} from "../studio/api.ts";
import type {StartReview,ReviewRequest,ReviewAction,ReviewState,ReviewList} from "./types.ts";
export const newReviewId=()=>studioOperationId("rv");
export const newReviewOperation=()=>studioOperationId("review");
export const startReview=(seed:LegacyChannelSeed,input:StartReview):Promise<ReviewState>=>
 invoke("review_start",{seed,input});
export const getReview=(seed:LegacyChannelSeed,reviewId:string):Promise<ReviewState>=>
 invoke("review_get",{seed,reviewId});
export const listReviews=(seed:LegacyChannelSeed):Promise<ReviewList>=>
 invoke("review_list",{seed});
export const readReview=(seed:LegacyChannelSeed,reviewId:string,kind:"script"|"prompt"|"raw"|"improvement",index=0):Promise<string>=>
 invoke("review_read",{seed,reviewId,kind,index});
export const readReviewHistory=(seed:LegacyChannelSeed,reviewId:string,
 kind:"script"|"prompt"|"raw"|"improvement",roundIndex:number,itemIndex:number):Promise<string>=>
 invoke("review_read_history",{seed,reviewId,kind,roundIndex,itemIndex});
export const applyReview=(seed:LegacyChannelSeed,request:ReviewRequest):Promise<ReviewState>=>
 invoke("review_apply",{seed,request});
export function buildReviewRequest(state:ReviewState,action:ReviewAction,operationId=newReviewOperation()):ReviewRequest{
 return {channelId:state.channelId,reviewId:state.reviewId,expectedRevision:state.revision,operationId,action};
}
export function sumScore(state:ReviewState):number|null{
 const round=state.rounds.at(-1);
 if(!round||round.sections.some(section=>section.score===null)||round.sections.length!==1)return null;
 return round.sections[0].score;
}
export function hasFullCoverage(state:ReviewState):boolean{
 const round=state.rounds.at(-1);
 return Boolean(round&&round.sections.length>0&&round.sections.every(s=>s.report!==null&&s.score!==null));
}
export function isCurrentApproved(state:ReviewState):boolean{
 const current=state.versions.at(-1);
 return Boolean(current&&state.approvals.some(a=>a.versionIndex===current.index&&a.scriptDigest===current.text.sha256));
}
export function reviewError(err:unknown):string{
 if(err&&typeof err==="object"&&"message" in err){
  const e=err as {code?:string;message:unknown};
  return String(e.code??"review_error")+": "+String(e.message);
 }
 return "Offline review operation failed; reload saved state before retrying.";
}
