import {invoke} from "@tauri-apps/api/core";
import type {LegacyChannelSeed} from "../studio/types.ts";
export type ChromeProvider="claude"|"chatgpt";
export interface ChromeAccountReport {
 provider:ChromeProvider;accountId:string;displayName:string;profileIdentity:string;
 savedAccountPresent:boolean;lastReportedConnected:boolean;signingIn:boolean;
 reportedAccountError:string;processState:string;lastLaunchError:string;
 authenticationVerified:boolean;canFocus:boolean;canCloseSafely:boolean;
}
export interface WorkspaceReport {
 browserAvailable:boolean;browserName:string;browserDiagnostic:string;
 accounts:ChromeAccountReport[];warning:string;
}
export const chromeStatus=(seed:LegacyChannelSeed,taskId:string):Promise<WorkspaceReport>=>
 invoke("chrome_workspace_status",{seed,taskId});
export const chromeOpen=(seed:LegacyChannelSeed,taskId:string,provider:ChromeProvider,accountId:string):Promise<WorkspaceReport>=>
 invoke("chrome_workspace_open",{seed,taskId,provider,accountId});
/** Display interpretation only. Rust is authoritative for account ownership and launch. */
export function accountSummary(report:ChromeAccountReport):string{
 if(!report.savedAccountPresent)return "Saved account missing; do not open a fallback profile.";
 if(report.processState==="already_running")return "Previously tracked process; switch to it manually.";
 if(report.processState==="process_running_window_not_verified")return "Browser process running; window and sign-in not verified.";
 if(report.processState.startsWith("not_observed"))return "Desktop restarted or no process tracked. Existing browser may still be open.";
 if(report.processState.includes("ended_at_once"))return "Browser handed off or ended immediately; check for profile-in-use.";
 if(report.processState==="launch_failed")return "Browser launch failed; saved profile preserved.";
 return "Browser is not verified open; reopen explicitly if needed.";
}
export function responseStats(s:string):{words:number;lines:number;bytes:number}{
 return {words:(s.match(/\S+/gu)??[]).length,lines:s.length?s.split(/\r\n|\n|\r/u).length:0,
  bytes:new TextEncoder().encode(s).length};
}
