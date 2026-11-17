import {invoke} from "@tauri-apps/api/core";
import type {LegacyChannelSeed} from "../studio/types.ts";
import {studioOperationId} from "../studio/api.ts";
import type {TaskStart,TaskRequest,SupervisorAction,SupervisorTask,MockScenario,MockResult} from "./types.ts";
export const newTaskId=()=>studioOperationId("su");
export const newSupervisorOperation=()=>studioOperationId("supervisor");
export const startTask=(seed:LegacyChannelSeed,input:TaskStart):Promise<SupervisorTask>=>
 invoke("supervisor_start",{seed,input});
export const getTask=(seed:LegacyChannelSeed,taskId:string):Promise<SupervisorTask>=>
 invoke("supervisor_get",{seed,taskId});
export const listTasks=(seed:LegacyChannelSeed):Promise<SupervisorTask[]>=>
 invoke("supervisor_list",{seed});
export const applyTask=(seed:LegacyChannelSeed,request:TaskRequest):Promise<SupervisorTask>=>
 invoke("supervisor_apply",{seed,request});
export const mockText=(seed:LegacyChannelSeed,taskId:string,partIndex:number,scenario:MockScenario):Promise<MockResult>=>
 invoke("supervisor_mock",{seed,taskId,partIndex,scenario});
export function taskRequest(task:SupervisorTask,action:SupervisorAction,operationId=newSupervisorOperation()):TaskRequest{
 return {channelId:task.channelId,taskId:task.taskId,expectedRevision:task.revision,operationId,action};
}
export function taskMessage(t:SupervisorTask):string{
 const last=t.events.at(-1)??"unknown";
 if(t.stage==="submission_uncertain")return "Submission status is UNCERTAIN. Never retry automatically; inspect the provider manually.";
 if(t.stage==="awaiting_user_action")return "Browser window opened or manual handoff needed. No provider submission or reply was verified.";
 if(t.stage==="prompt_prepared")return "Local prompt prepared and stored. It has NOT been submitted.";
 if(t.stage==="completed")return "Rust verified an explicit approval record bound to the latest script and review.";
 return t.stage.replace(/_/g," ")+" — "+last.replace(/_/g," ");
}
export function supervisorError(error:unknown):string{
 if(error&&typeof error==="object"&&"message" in error)return String((error as {message:unknown}).message);
 return "Supervisor failed. Reload the immutable state; do not repeat uncertain provider requests.";
}
