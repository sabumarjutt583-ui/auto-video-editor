import { invoke } from "@tauri-apps/api/core";

export interface TextAnswer {
  text: string;
  /** "gemini", or "groq" when the backup was used. */
  provider: "gemini" | "groq";
}

/** Asks Gemini (with the optional Groq backup from Settings) and returns the answer text. */
export function generateText(prompt: string, system: string | null, json: boolean, jobId: string): Promise<TextAnswer> {
  return invoke<TextAnswer>("generate_text", { system, prompt, json, jobId });
}
