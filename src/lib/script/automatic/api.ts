import {invoke} from "@tauri-apps/api/core";
import type {LegacyChannelSeed,ScriptMode} from "../studio/types.ts";
import type {SupervisorTask} from "../supervisor/types.ts";
import type {ExecutionState} from "../execution/types.ts";
import type {ReviewState} from "../review/types.ts";
export type AutoMode="local_fixture"|"authorized_browser";
export interface AutoCapability{automatic:boolean;authorized:boolean;realAi:boolean;provenance:string;reason:string}
export interface AutoPolicy{schemaVersion:number;channelId:string;taskId:string;executionId:string;planId:string;planDigest:string;
 mode:AutoMode;reviewTarget:number;maxImprovements:number;integritySha256:string}
export interface AutoView{task:SupervisorTask;execution:ExecutionState;review:ReviewState|null;
 policy:AutoPolicy;capability:AutoCapability;workerRunning:boolean;workerError:string|null;realAiResultVerified:boolean}
export interface AutoStart{title:string;topic:string;scriptMode:ScriptMode;targetWords:number;partCount:number;
 reviewTarget:number;maxImprovements:number;mode:AutoMode}
export const autoCapability=(mode:AutoMode):Promise<AutoCapability>=>invoke("auto_capability",{mode});
export const autoGenerate=(seed:LegacyChannelSeed,request:AutoStart):Promise<AutoView>=>invoke("auto_generate",{seed,request});
export const autoStatus=(seed:LegacyChannelSeed,taskId:string):Promise<AutoView>=>invoke("auto_status",{seed,taskId});
export const autoList=(seed:LegacyChannelSeed):Promise<SupervisorTask[]>=>invoke("auto_list",{seed});
export const autoControl=(seed:LegacyChannelSeed,taskId:string,action:"pause"|"resume"|"cancel"|"recover"):Promise<AutoView>=>
 invoke("auto_control",{seed,taskId,action});
export const autoApprove=(seed:LegacyChannelSeed,taskId:string,confirmation:string):Promise<AutoView>=>
 invoke("auto_approve",{seed,taskId,confirmation});
export function automaticProgress(view:AutoView):string{
 const parts=view.execution.completedParts+"/"+view.execution.totalParts+" parts";
 const round=view.review?.rounds.at(-1);
 const completed=round?.sections.filter(s=>s.report&&s.score!==null).length??0;
 const scores=round?.sections.map(s=>s.score).filter((x):x is number=>x!==null)??[];
 const reviewComplete=Boolean(round&&completed===round.sections.length&&scores.length>0);
 const targetUnmet=reviewComplete&&Boolean(view.policy&&Math.min(...scores)<view.policy.reviewTarget);
 return parts+(round?" · review "+completed+"/"+round.sections.length+" sections":"")+
  (targetUnmet?" · MOCK review target unmet":"")+
  (view.workerRunning?" · active MOCK worker":" · stopped")+
  (view.task.stage==="awaiting_approval"?" · pending human approval":"");
}
