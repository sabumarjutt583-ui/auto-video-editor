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

/** One Claude account in the Settings list. The first account is the original single sign-in. */
export interface ScriptAccountStatus extends ScriptStatus {
  id: string;
  name: string;
}

export const scriptAccounts = (): Promise<ScriptAccountStatus[]> => invoke<ScriptAccountStatus[]>("script_accounts");
export const scriptAddAccount = (name?: string): Promise<ScriptAccountStatus> => invoke<ScriptAccountStatus>("script_add_account", { name: name ?? null });
export const scriptDeleteAccount = (id: string): Promise<ScriptAccountStatus[]> => invoke<ScriptAccountStatus[]>("script_delete_account", { id });
export const scriptAccountSignIn = (id: string): Promise<ScriptAccountStatus> => invoke<ScriptAccountStatus>("script_account_sign_in", { id });
export const scriptAccountConfirmSignedIn = (id: string): Promise<void> => invoke<void>("script_account_confirm_signed_in", { id });
export const scriptAccountCheck = (id: string): Promise<ScriptAccountStatus> => invoke<ScriptAccountStatus>("script_account_check", { id });
export const scriptAccountDisconnect = (id: string): Promise<ScriptAccountStatus> => invoke<ScriptAccountStatus>("script_account_disconnect", { id });
/** Opens one Claude account's chat page in the person's own browser window, view-only. */
export const scriptOpenLive = (accountId?: string | null): Promise<void> => invoke<void>("script_open_live", { accountId: accountId ?? null });
export const scriptAccountSetLimit = (id: string, untilMs: number): Promise<ScriptAccountStatus> => invoke<ScriptAccountStatus>("script_account_set_limit", { id, untilMs });

/** Claude's answer to one question, in a fresh chat. Can be cancelled like other jobs. */
export async function scriptAsk(prompt: string, accountId?: string | null): Promise<string> {
  const answer = await runJob("script", "Writing the script", (jobId) => invoke<{ text: string }>("script_ask", { prompt, jobId, accountId: accountId ?? null }));
  return answer.text;
}
