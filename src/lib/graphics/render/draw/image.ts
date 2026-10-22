import type { Layer } from "../../spec/schema.ts";
import type { Area, Canvas2D, RenderContext, RenderNote } from "../context.ts";
import { roundedRect } from "./path.ts";

type ImageLayer = Extract<Layer, { type: "image" }>;

function sizeOf(source: CanvasImageSource): { w: number; h: number } {
  const s = source as { width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number };
  const w = s.naturalWidth ?? s.videoWidth ?? (typeof s.width === "number" ? s.width : 0);
  const h = s.naturalHeight ?? s.videoHeight ?? (typeof s.height === "number" ? s.height : 0);
  return { w, h };
}

export function drawImage(ctx: Canvas2D, layer: ImageLayer, area: Area, rc: RenderContext, note: (n: RenderNote) => void): void {
  const source = rc.image(layer.src);
  const { w, h } = source ? sizeOf(source) : { w: 0, h: 0 };
  if (!source || w <= 0 || h <= 0) {
    note({ layerId: layer.id, kind: "missing-image", message: `The picture ${layer.src} could not be loaded.` });
    return;
  }
  const scale = layer.fit === "cover" ? Math.max(area.w / w, area.h / h) : Math.min(area.w / w, area.h / h);
  const dw = w * scale;
  const dh = h * scale;
  const dx = area.x + (area.w - dw) / 2;
  const dy = area.y + (area.h - dh) / 2;
  ctx.save();
  if (layer.radius > 0 || layer.fit === "cover") {
    // The clip is the box for "cover" and the picture itself for "contain".
    if (layer.fit === "cover") roundedRect(ctx, area.x, area.y, area.w, area.h, layer.radius * Math.min(area.w, area.h));
    else roundedRect(ctx, dx, dy, dw, dh, layer.radius * Math.min(dw, dh));
    ctx.clip();
  }
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.restore();
}
