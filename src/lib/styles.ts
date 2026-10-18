import { invoke } from "@tauri-apps/api/core";

import type { StyleLibrary, StyleProfile } from "../types";

export function listStyles(): Promise<StyleLibrary> {
  return invoke<StyleLibrary>("list_styles");
}

export function saveCustomStyle(style: StyleProfile): Promise<StyleProfile> {
  return invoke<StyleProfile>("save_custom_style", { style });
}

export function deleteCustomStyle(id: string): Promise<void> {
  return invoke<void>("delete_custom_style", { id });
}
