import { invoke } from "@tauri-apps/api/core";

/** Saves text (TXT, CSV or JSON) to a path chosen in the save dialog. */
export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_text_file", { path, content });
}
