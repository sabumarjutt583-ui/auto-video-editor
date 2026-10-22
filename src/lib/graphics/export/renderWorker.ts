/// <reference lib="webworker" />
// Draws graphic frames off the main thread with an OffscreenCanvas. The drawing code is the same `renderFrame` the preview uses.
import type { MapData, MapResolution } from "../geo/mapData.ts";
import type { IconShape, RenderContext } from "../render/context.ts";
import { renderFrame } from "../render/renderFrame.ts";
import type { Theme } from "../render/theme.ts";
import type { GraphicSpec } from "../spec/schema.ts";

export interface WorkerFont {
  family: string;
  weight: string;
  data: ArrayBuffer;
}

export type ToWorker =
  | { type: "init"; spec: GraphicSpec; width: number; height: number; fonts: WorkerFont[]; images: Record<string, ImageBitmap>; icons: Record<string, IconShape>; maps: Partial<Record<MapResolution, MapData>>; theme: Theme }
  | { type: "frame"; n: number };

export type FromWorker =
  | { type: "ready" }
  | { type: "frame"; n: number; buffer: ArrayBuffer }
  | { type: "error"; message: string; n?: number };

let spec: GraphicSpec | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let rc: RenderContext | null = null;
let size = { width: 0, height: 0 };

const post = (message: FromWorker, transfer: Transferable[] = []): void => self.postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const fonts = (self as unknown as { fonts: FontFaceSet }).fonts;
      for (const font of message.fonts) {
        const face = new FontFace(font.family, font.data, { weight: font.weight });
        await face.load();
        fonts.add(face);
      }
      spec = message.spec;
      size = { width: message.width, height: message.height };
      const canvas = new OffscreenCanvas(message.width, message.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("This computer cannot draw on an OffscreenCanvas.");
      ctx = context;
      const images = message.images;
      const icons = message.icons;
      const maps = message.maps;
      rc = {
        width: message.width, height: message.height, theme: message.theme,
        image: (src) => images[src],
        icon: (set, name) => icons[`${set}:${name}`],
        flag: (code) => images[`flag:${code.toUpperCase()}`],
        map: (resolution) => maps[resolution],
      };
      post({ type: "ready" });
    } else if (spec && ctx && rc) {
      renderFrame(spec, message.n, ctx, rc);
      const pixels = ctx.getImageData(0, 0, size.width, size.height);
      post({ type: "frame", n: message.n, buffer: pixels.data.buffer as ArrayBuffer }, [pixels.data.buffer as ArrayBuffer]);
    } else {
      throw new Error("The drawing worker was not started.");
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error), ...(message.type === "frame" ? { n: message.n } : {}) });
  }
};
