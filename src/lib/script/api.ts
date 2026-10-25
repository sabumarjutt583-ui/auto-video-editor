import { invoke } from "@tauri-apps/api/core";

import { runJob } from "../../store/jobStore.ts";

export interface ScriptStatus {
  /** The person accepted the notice about using the chat page. */
  consent: boolean;
  connected: boolean;
  signingIn: boolean;
  busy: boolean;
  /** Epoch milliseconds until which Claude's usage limit rests the account (0 = not resting). */
  limitedUntil: number;
  lastError: string;
}

export const scriptStatus = (): Promise<ScriptStatus> => invoke<ScriptStatus>("script_status");
export const scriptAcceptConsent = (): Promise<ScriptStatus> => invoke<ScriptStatus>("script_accept_consent");
export const scriptSignIn = (): Promise<ScriptStatus> => invoke<ScriptStatus>("script_sign_in");
export const scriptConfirmSignedIn = (): Promise<void> => invoke<void>("script_confirm_signed_in");
export const scriptCheck = (): Promise<ScriptStatus> => invoke<ScriptStatus>("script_check");
export const scriptDisconnect = (): Promise<ScriptStatus> => invoke<ScriptStatus>("script_disconnect");

/** Claude's answer to one question, in a fresh chat. Can be cancelled like other jobs. */
export async function scriptAsk(prompt: string): Promise<string> {
  const answer = await runJob("script", "Writing the script", (jobId) => invoke<{ text: string }>("script_ask", { prompt, jobId }));
  return answer.text;
}
