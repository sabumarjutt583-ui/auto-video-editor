import { invoke } from "@tauri-apps/api/core";

import type { KeySlotInfo, KeyStatus, Provider } from "../types";

// Keys are stored and used only in Rust. The frontend sends a key once (to save it)
// and afterwards can only ask whether one is set.

/** Saves a key. `slot` is the key number (1 = the first key). */
export function saveKey(provider: Provider, key: string, slot = 1): Promise<void> {
  return invoke<void>("save_key", { provider, key, slot });
}

/** Whether ANY key of the provider is saved. */
export function getKeyStatus(provider: Provider): Promise<KeyStatus> {
  return invoke<KeyStatus>("get_key_status", { provider });
}

/** All key places of the provider (Gemini and Groq: 10, OpenAI: 1) and whether each has a key. */
export function getKeySlots(provider: Provider): Promise<KeySlotInfo[]> {
  return invoke<KeySlotInfo[]>("get_key_slots", { provider });
}

export function deleteKey(provider: Provider, slot = 1): Promise<void> {
  return invoke<void>("delete_key", { provider, slot });
}

/** Tests one saved key. Resolves when it works, rejects with an AppError otherwise. */
export function testKey(provider: Provider, model?: string, slot = 1): Promise<void> {
  return invoke<void>("test_key", { provider, model: model ?? null, slot });
}

/** The key place a new key goes to: the first free one, or the last one when all are full (it replaces that key). */
export function slotForNewKey(slots: readonly KeySlotInfo[]): number {
  const free = slots.find((s) => s.status === "not_set");
  if (free) return free.slot;
  return slots.length > 0 ? slots[slots.length - 1].slot : 1;
}

/** True when every place already holds a key. */
export function slotsFull(slots: readonly KeySlotInfo[]): boolean {
  return slots.length > 0 && slots.every((s) => s.status === "set");
}

/** "2 min" / "1 h" for the rest time of a limited key. */
export function restText(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}
