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

/** Makes the thumbnail of one of the user's own styles from a picture file (cropped to 4:3). Returns the saved style. */
export function setCustomStyleThumbnail(id: string, source: string): Promise<StyleProfile> {
  return invoke<StyleProfile>("set_custom_style_thumbnail", { id, source });
}
