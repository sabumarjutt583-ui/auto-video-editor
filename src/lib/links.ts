import { invoke } from "@tauri-apps/api/core";

/** The only pages the app can open in the system browser (the list lives in Rust). */
export type ExternalLink = "groq_keys" | "gemini_keys" | "openai_keys" | "flow_batch";

export function openExternalLink(link: ExternalLink): Promise<void> {
  return invoke<void>("open_external_link", { link });
}
