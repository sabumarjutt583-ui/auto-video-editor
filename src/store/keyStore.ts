import { create } from "zustand";

import { deleteKey, getKeyStatus, saveKey } from "../lib/keys";
import { toAppError } from "../lib/errors";
import type { AppError, KeyStatus, Provider } from "../types";

export type KeyStatusValue = KeyStatus | "unknown";

interface KeyState {
  status: Record<Provider, KeyStatusValue>;
  /** Set when the system keychain itself cannot be used. */
  error: AppError | null;
  refresh: (provider: Provider) => Promise<void>;
  refreshAll: () => Promise<void>;
  /** Rejects with an AppError when the key cannot be saved. */
  save: (provider: Provider, key: string) => Promise<void>;
  /** Rejects with an AppError when the key cannot be deleted. */
  remove: (provider: Provider) => Promise<void>;
}

// This store only ever holds "set" / "not_set". A key being typed lives in the input's
// own state and is cleared right after it is saved.
export const useKeyStore = create<KeyState>((set, get) => ({
  status: { groq: "unknown", gemini: "unknown" },
  error: null,

  refresh: async (provider) => {
    try {
      const status = await getKeyStatus(provider);
      set((state) => ({ status: { ...state.status, [provider]: status }, error: null }));
    } catch (error) {
      set((state) => ({
        status: { ...state.status, [provider]: "unknown" },
        error: toAppError(error, "The system keychain could not be checked."),
      }));
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refresh("groq"), get().refresh("gemini")]);
  },

  save: async (provider, key) => {
    await saveKey(provider, key);
    set((state) => ({ status: { ...state.status, [provider]: "set" }, error: null }));
  },

  remove: async (provider) => {
    await deleteKey(provider);
    set((state) => ({ status: { ...state.status, [provider]: "not_set" }, error: null }));
  },
}));
