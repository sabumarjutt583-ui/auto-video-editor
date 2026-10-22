import { frameCount } from "../render/timing.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import type { ExportApi, GraphicClip } from "./api.ts";

/** Draws the frames of one graphic, in any order (a Web Worker draws them off the main thread). */
export interface FrameSource {
  /** Frame `n` as RGBA bytes (straight alpha, rows top to bottom), `width * height * 4` long. */
  frame: (n: number) => Promise<ArrayBuffer>;
  close: () => void;
}

export interface ExportOptions {
  projectId: string;
  graphicId: string;
  spec: GraphicSpec;
  width: number;
  height: number;
  /** The id of the background job (progress and Cancel). */
  jobId: string;
  api: ExportApi;
  createSource: () => Promise<FrameSource>;
  /** Frames drawn ahead while the previous ones are being sent. */
  ahead?: number;
  isCancelled?: () => boolean;
}

export class ExportCancelled extends Error {
  constructor() {
    super("The graphic export was cancelled.");
  }
}

/**
 * Draws every frame of a graphic and streams it to the engine, which writes the transparent clip.
 * Frames are drawn ahead (a few at a time) while earlier ones are sent, so drawing and saving overlap.
 * Any failure or Cancel stops the engine and removes its temporary file.
 */
export async function exportGraphic(options: ExportOptions): Promise<GraphicClip> {
  const { api, jobId } = options;
  const total = frameCount(options.spec.duration);
  const ahead = Math.max(1, options.ahead ?? 3);
  let source: FrameSource | null = null;
  try {
    await api.start(options.projectId, options.graphicId, options.width, options.height, total, jobId);
    source = await options.createSource();
    const pending: Promise<ArrayBuffer>[] = [];
    let next = 0;
    for (let sent = 0; sent < total; sent++) {
      if (options.isCancelled?.()) throw new ExportCancelled();
      while (next < total && pending.length < ahead) pending.push(source.frame(next++));
      const bytes = await pending.shift();
      if (!bytes) throw new Error("A frame was not drawn.");
      await api.frame(jobId, new Uint8Array(bytes));
    }
    return await api.finish(jobId);
  } catch (error) {
    await api.abort(jobId).catch(() => undefined);
    throw error;
  } finally {
    source?.close();
  }
}
