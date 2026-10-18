import { invoke } from "@tauri-apps/api/core";

import type { AssRequest } from "./assRequest";

/** The folder with the bundled fonts. */
export function fontsDir(): Promise<string> {
  return invoke<string>("fonts_dir");
}

/** Writes the captions as an ASS file in the project's exports folder. Gives back the file's path. */
export function generateAss(projectId: string, request: AssRequest): Promise<string> {
  return invoke<string>("generate_ass", { projectId, request });
}
