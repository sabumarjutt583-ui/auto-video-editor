import { invoke } from "@tauri-apps/api/core";

/** Asks the current AI engine about up to four preview pictures of the project (`thumbs/...jpg`). Returns its JSON text. */
export function placementAsk(projectId: string, system: string, prompt: string, pictures: string[], jobId: string): Promise<string> {
  return invoke<string>("placement_ask", { projectId, system, prompt, pictures, jobId });
}
