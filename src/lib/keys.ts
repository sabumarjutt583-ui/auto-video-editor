import { invoke } from "@tauri-apps/api/core";

import type { KeyStatus, Provider } from "../types";

// Keys are stored and used only in Rust. The frontend sends a key once (to save it)
// and afterwards can only ask whether one is set.

export function saveKey(provider: Provider, key: string): Promise<void> {
  return invoke<void>("save_key", { provider, key });
}

export function getKeyStatus(provider: Provider): Promise<KeyStatus> {
  return invoke<KeyStatus>("get_key_status", { provider });
}

export function deleteKey(provider: Provider): Promise<void> {
  return invoke<void>("delete_key", { provider });
}

/** Tests the saved key. Resolves when it works, rejects with an AppError otherwise. */
export function testKey(provider: Provider, model?: string): Promise<void> {
  return invoke<void>("test_key", { provider, model: model ?? null });
}
