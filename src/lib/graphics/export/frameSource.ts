import { convertFileSrc } from "@tauri-apps/api/core";

import { fontsDir } from "../../captions/api.ts";
import { flagCodesOf, loadFlagBitmaps } from "../library/flags.ts";
import { ensureIcons, iconRefsOf, iconsOfSpec } from "../library/icons.ts";
import { loadGraphicFonts, previewContext } from "../render/browser.ts";
import { renderFrame } from "../render/renderFrame.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import type { FrameSource } from "./exportGraphic.ts";
import { fontsFor } from "./fonts.ts";
import type { FromWorker, ToWorker, WorkerFont } from "./renderWorker.ts";

const fontCache = new Map<string, Promise<ArrayBuffer>>();

async function fontBytes(dir: string, file: string): Promise<ArrayBuffer> {
  const separator = dir.includes("\\") ? "\\" : "/";
  const url = convertFileSrc(`${dir}${separator}${file}`);
  const cached = fontCache.get(url);
  if (cached) return cached;
  const task = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`The font file ${file} could not be read.`);
    return r.arrayBuffer();
  });
  fontCache.set(url, task);
  task.catch(() => fontCache.delete(url));
  return task;
}

async function workerFonts(spec: GraphicSpec): Promise<WorkerFont[]> {
  const dir = await fontsDir();
  const out: WorkerFont[] = [];
  for (const font of fontsFor(spec)) {
    // A copy per export: the bytes are cloned into the worker and the cached original stays usable.
    out.push({ family: font.family, weight: "400", data: (await fontBytes(dir, font.regular)).slice(0) });
    out.push({ family: font.family, weight: "700", data: (await fontBytes(dir, font.bold)).slice(0) });
  }
  return out;
}

/** The pictures a graphic uses, loaded from the project folder. A picture that cannot be read is left out (the renderer notes it). */
export async function loadImages(spec: GraphicSpec, projectDir: string): Promise<Record<string, ImageBitmap>> {
  const out: Record<string, ImageBitmap> = await loadFlagBitmaps(flagCodesOf(spec));
  const separator = projectDir.includes("\\") ? "\\" : "/";
  for (const layer of spec.layers) {
    if (layer.type !== "image" || layer.src in out) continue;
    try {
      const response = await fetch(convertFileSrc(`${projectDir}${separator}${layer.src}`));
      if (response.ok) out[layer.src] = await createImageBitmap(await response.blob());
    } catch {
      // Left out on purpose.
    }
  }
  return out;
}

/** Frames drawn in a Web Worker (OffscreenCanvas), one request at a time per frame, answers matched by frame number. */
async function workerSource(spec: GraphicSpec, width: number, height: number, images: Record<string, ImageBitmap>): Promise<FrameSource> {
  const worker = new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>();
  let ready: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const failAll = (error: Error) => {
    ready?.reject(error);
    for (const entry of waiting.values()) entry.reject(error);
    waiting.clear();
  };
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.type === "ready") ready?.resolve();
    else if (message.type === "frame") {
      waiting.get(message.n)?.resolve(message.buffer);
      waiting.delete(message.n);
    } else if (message.n !== undefined) {
      waiting.get(message.n)?.reject(new Error(message.message));
      waiting.delete(message.n);
    } else failAll(new Error(message.message));
  };
  worker.onerror = (event) => failAll(new Error(event.message || "The drawing worker failed."));
  const started = new Promise<void>((resolve, reject) => { ready = { resolve, reject }; });
  const init: ToWorker = { type: "init", spec, width, height, fonts: await workerFonts(spec), images, icons: await iconsOfSpec(spec) };
  worker.postMessage(init, Object.values(images));
  await started;
  return {
    frame: (n) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        waiting.set(n, { resolve, reject });
        const message: ToWorker = { type: "frame", n };
        worker.postMessage(message);
      }),
    close: () => worker.terminate(),
  };
}

/** The same drawing on the main thread, for a webview without Worker or OffscreenCanvas support. */
async function mainSource(spec: GraphicSpec, width: number, height: number, images: Record<string, ImageBitmap>): Promise<FrameSource> {
  await loadGraphicFonts();
  await ensureIcons(iconRefsOf(spec));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This computer cannot draw the graphic.");
  const rc = previewContext(width, height, new Map(Object.entries(images)));
  return {
    frame: async (n) => {
      renderFrame(spec, n, ctx, rc);
      return ctx.getImageData(0, 0, width, height).data.buffer as ArrayBuffer;
    },
    close: () => undefined,
  };
}

/** Draws the frames of a graphic at the video's size. Uses a Web Worker when the webview can, the main thread otherwise. */
export async function createFrameSource(spec: GraphicSpec, width: number, height: number, projectDir: string): Promise<FrameSource> {
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      // The pictures are handed over to the worker (they cannot be used here afterwards).
      return await workerSource(spec, width, height, await loadImages(spec, projectDir));
    } catch {
      // Fall through: the main thread draws the same pixels, only slower.
    }
  }
  return mainSource(spec, width, height, await loadImages(spec, projectDir));
}
