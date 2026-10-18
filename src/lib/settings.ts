import { invoke } from "@tauri-apps/api/core";

import type { AppSettings } from "../types";

export function loadSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_settings");
}

/** Saves the settings. Resolves to the tidied values that were stored. */
export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("save_settings", { settings });
}
