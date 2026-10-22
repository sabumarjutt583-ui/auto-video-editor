import { invoke } from "@tauri-apps/api/core";

/** What `graphic_export_finish` returns (mirrors src-tauri/src/graphics/export.rs). */
export interface GraphicClip {
  path: string;
  frames: number;
  width: number;
  height: number;
  sizeBytes: number;
}

/** The calls the export needs. A test passes a fake. */
export interface ExportApi {
  start: (projectId: string, graphicId: string, width: number, height: number, frames: number, jobId: string) => Promise<void>;
  frame: (jobId: string, rgba: Uint8Array) => Promise<void>;
  finish: (jobId: string) => Promise<GraphicClip>;
  abort: (jobId: string) => Promise<void>;
}

export const tauriExportApi: ExportApi = {
  start: (projectId, graphicId, width, height, frames, jobId) => invoke("graphic_export_start", { projectId, graphicId, width, height, frames, jobId }),
  // A raw body (no JSON, no base64): one frame is up to 33 MB at 4K.
  frame: (jobId, rgba) => invoke("graphic_export_frame", rgba, { headers: { "x-job-id": jobId } }),
  finish: (jobId) => invoke<GraphicClip>("graphic_export_finish", { jobId }),
  abort: (jobId) => invoke("graphic_export_abort", { jobId }),
};
