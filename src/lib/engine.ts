import { invoke } from "@tauri-apps/api/core";

/** Asks the Rust side to run `ffmpeg -version`. Resolves to the version, rejects with an AppError. */
export function checkFfmpeg(): Promise<string> {
  return invoke<string>("check_ffmpeg");
}
