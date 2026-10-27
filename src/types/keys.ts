export type Provider = "groq" | "gemini" | "openai";

/** Whether a key is saved. The key itself never reaches the frontend. */
export type KeyStatus = "set" | "not_set";

/** One key place of a provider, for the list in Settings (never contains the key). */
export interface KeySlotInfo {
  slot: number;
  status: KeyStatus;
  /** Seconds the key still rests after a usage limit (0 = ready). */
  restingSeconds: number;
  /** Epoch milliseconds when the key is back online (0 = ready). Older builds leave this out. */
  restingUntilMs?: number;
}
