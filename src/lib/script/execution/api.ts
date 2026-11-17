import { invoke } from "@tauri-apps/api/core";
import type { LegacyChannelSeed } from "../studio/types.ts";
import { studioOperationId } from "../studio/api.ts";
import type { ExecutionAction, ExecutionList, ExecutionRequest, ExecutionState, StartExecution } from "./types.ts";

export const newExecutionId = () => studioOperationId("ex");
export const newExecutionOperationId = () => studioOperationId("exec");
export const startExecution = (seed:LegacyChannelSeed,input:StartExecution):Promise<ExecutionState> =>
  invoke("execution_start",{seed,input});
export const getExecution = (seed:LegacyChannelSeed,executionId:string):Promise<ExecutionState> =>
  invoke("execution_get",{seed,executionId});
export const listExecutions = (seed:LegacyChannelSeed):Promise<ExecutionList> =>
  invoke("execution_list",{seed});
export const applyExecution = (seed:LegacyChannelSeed,request:ExecutionRequest):Promise<ExecutionState> =>
  invoke("execution_apply",{seed,request});
export const readExecution = (seed:LegacyChannelSeed,executionId:string,kind:string,partIndex=0,fragmentIndex=0):Promise<string> =>
  invoke("execution_read",{seed,executionId,kind,partIndex,fragmentIndex});
export const readCandidate = (seed:LegacyChannelSeed,executionId:string,partIndex:number):Promise<string> =>
  invoke("execution_candidate",{seed,executionId,partIndex});
export function buildExecutionRequest(state:ExecutionState,action:ExecutionAction,operationId=newExecutionOperationId()):ExecutionRequest {
  return {channelId:state.channelId,executionId:state.executionId,
    expectedRevision:state.revision,operationId,action};
}
export function errorDescription(error:unknown):string{
  if(error&&typeof error==="object"&&"message" in error&&typeof error.message==="string"){
    return String((error as {code?:string}).code??"execution_error")+": "+error.message;
  }
  return "Offline execution failed. Reload and inspect the saved state; no provider request occurred.";
}
