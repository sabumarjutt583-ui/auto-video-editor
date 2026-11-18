import type {TaskStage} from "../supervisor/types.ts";
export function operatorCanEdit(stage:TaskStage):boolean{
 return !["paused","cancelled","completed","failed"].includes(stage);
}
/** Preserve active review section only within the identical review round. */
export function selectReviewSection(previous:{reviewId:string;round:number;index:number}|null,
 reviewId:string,round:number,count:number):number{
 if(count<=0)return 0;
 if(previous?.reviewId!==reviewId||previous.round!==round)return 0;
 return Number.isInteger(previous.index)&&previous.index>=0&&previous.index<count?previous.index:0;
}
