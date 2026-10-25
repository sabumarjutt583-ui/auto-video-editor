import { create } from "zustand";

import { deleteKey, getKeySlots, saveKey } from "../lib/keys";
import { toAppError } from "../lib/errors";
import type { AppError, KeySlotInfo, KeyStatus, Provider } from "../types";

export type KeyStatusValue = KeyStatus | "unknown";

interface KeyState {
  /** Whether ANY key of the provider is saved. */
  status: Record<Provider, KeyStatusValue>;
  /** The key places of each provider (empty until loaded). */
  slots: Record<Provider, KeySlotInfo[]>;
  /** Set when the system keychain itself cannot be used. */
  error: AppError | null;
  refresh: (provider: Provider) => Promise<void>;
  refreshAll: () => Promise<void>;
  /** Saves a key in the given place. Rejects with an AppError when the key cannot be saved. */
  save: (provider: Provider, key: string, slot: number) => Promise<void>;
  /** Rejects with an AppError when the key cannot be deleted. */
  remove: (provider: Provider, slot: number) => Promise<void>;
}

export function anySet(slots: readonly KeySlotInfo[]): KeyStatus {
  return slots.some((s) => s.status === "set") ? "set" : "not_set";
}

// This store only ever holds "set" / "not_set". A key being typed lives in the input's
// own state and is cleared right after it is saved.
export const useKeyStore = create<KeyState>((set, get) => ({
  status: { groq: "unknown", gemini: "unknown", openai: "unknown" },
  slots: { groq: [], gemini: [], openai: [] },
  error: null,

  refresh: async (provider) => {
    try {
      const slots = await getKeySlots(provider);
      set((state) => ({
        status: { ...state.status, [provider]: anySet(slots) },
        slots: { ...state.slots, [provider]: slots },
        error: null,
      }));
    } catch (error) {
      set((state) => ({
        status: { ...state.status, [provider]: "unknown" },
        error: toAppError(error, "The system keychain could not be checked."),
      }));
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refresh("groq"), get().refresh("gemini"), get().refresh("openai")]);
  },

  save: async (provider, key, slot) => {
    await saveKey(provider, key, slot);
    await get().refresh(provider);
  },

  remove: async (provider, slot) => {
    await deleteKey(provider, slot);
    await get().refresh(provider);
  },
}));
