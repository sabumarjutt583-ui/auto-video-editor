import { invoke } from "@tauri-apps/api/core";

export interface ChatGptAccountStatus {
  id: string;
  name: string;
  consent: boolean;
  connected: boolean;
  signingIn: boolean;
  busy: boolean;
  /** Epoch milliseconds until which the account rests after a usage limit (0 = not resting). */
  limitedUntil: number;
  lastError: string;
}

export const chatgptAccounts = (): Promise<ChatGptAccountStatus[]> => invoke<ChatGptAccountStatus[]>("chatgpt_accounts");
export const chatgptAddAccount = (name?: string): Promise<ChatGptAccountStatus> => invoke<ChatGptAccountStatus>("chatgpt_add_account", { name: name ?? null });
export const chatgptDeleteAccount = (id: string): Promise<ChatGptAccountStatus[]> => invoke<ChatGptAccountStatus[]>("chatgpt_delete_account", { id });
export const chatgptAccountSignIn = (id: string): Promise<ChatGptAccountStatus> => invoke<ChatGptAccountStatus>("chatgpt_account_sign_in", { id });
export const chatgptAccountConfirmSignedIn = (id: string): Promise<void> => invoke<void>("chatgpt_account_confirm_signed_in", { id });
export const chatgptAccountCheck = (id: string): Promise<ChatGptAccountStatus> => invoke<ChatGptAccountStatus>("chatgpt_account_check", { id });
export const chatgptAccountDisconnect = (id: string): Promise<ChatGptAccountStatus> => invoke<ChatGptAccountStatus>("chatgpt_account_disconnect", { id });
export const chatgptAccountSetLimit = (id: string, untilMs: number): Promise<ChatGptAccountStatus> => invoke<ChatGptAccountStatus>("chatgpt_account_set_limit", { id, untilMs });
export const chatgptAcceptConsent = (): Promise<ChatGptAccountStatus[]> => invoke<ChatGptAccountStatus[]>("chatgpt_accept_consent");
/** Opens one ChatGPT account's chat page in the person's own browser window, view-only. */
export const chatgptOpenLive = (accountId?: string | null): Promise<void> => invoke<void>("chatgpt_open_live", { accountId: accountId ?? null });
