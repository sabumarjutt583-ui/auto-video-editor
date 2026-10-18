import { invoke } from "@tauri-apps/api/core";

import type { TimedWord } from "./types.ts";

/** Reads a text file chosen by the user (UTF-8 or UTF-16). */
export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** Sends the voice to Groq Whisper and returns the words with times. */
export function transcribeVoice(projectId: string, voicePath: string, language: string, jobId: string): Promise<TimedWord[]> {
  return invoke<TimedWord[]>("transcribe_voice", {
    projectId,
    voicePath,
    language: language === "" ? null : language,
    jobId,
  });
}
