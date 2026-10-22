import type { GraphicSpec, Layer } from "../spec/schema.ts";
import { poseOf } from "./anim.ts";
import type { Area, Canvas2D, FrameReport, RenderContext, RenderNote } from "./context.ts";
import { drawIcon } from "./draw/icon.ts";
import { drawImage } from "./draw/image.ts";
import { drawShape } from "./draw/shape.ts";
import { drawTextLike } from "./draw/text.ts";
import type { Pose } from "./anim.ts";
import { FPS, layerTiming } from "./timing.ts";

export interface RenderOptions {
  /** Sub-frames blended into one frame (1 = off). "High quality" uses 4 to 8. */
  motionBlurSamples?: number;
  /** Share of the frame time the shutter is open (0..1). Default 0.5. */
  shutter?: number;
}

function areaOf(layer: Layer, rc: RenderContext): Area {
  return { x: layer.box.x * rc.width, y: layer.box.y * rc.height, w: layer.box.w * rc.width, h: layer.box.h * rc.height };
}

function drawLayer(ctx: Canvas2D, layer: Layer, area: Area, pose: Pose, rc: RenderContext, note: (n: RenderNote) => void): boolean {
  switch (layer.type) {
    case "text":
    case "richText":
      drawTextLike(ctx, layer, area, pose, rc, note);
      return true;
    case "shape":
      drawShape(ctx, layer, area, rc);
      return true;
    case "icon":
      drawIcon(ctx, layer, area, rc, note);
      return true;
    case "image":
      drawImage(ctx, layer, area, rc, note);
      return true;
    default:
      note({ layerId: layer.id, kind: "not-drawn", message: `The layer type "${layer.type}" is not drawn yet.` });
      return false;
  }
}

/** Draws the graphic at one moment (`frame` may be fractional) onto a transparent canvas. Pure: same input, same pixels. */
function draw(spec: GraphicSpec, frame: number, ctx: Canvas2D, rc: RenderContext, report: FrameReport): void {
  const t = frame / FPS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, rc.width, rc.height);
  const note = (n: RenderNote): void => {
    if (!report.notes.some((x) => x.layerId === n.layerId && x.kind === n.kind)) report.notes.push(n);
  };
  for (const layer of spec.layers) {
    const timing = layerTiming(layer, spec.duration, t);
    if (!timing.visible) continue;
    const pose = poseOf(layer, timing, rc.width, rc.height);
    if (pose.alpha <= 0.0005 || pose.clipTo <= pose.clipFrom) continue;
    const area = areaOf(layer, rc);
    ctx.save();
    ctx.globalAlpha = Math.min(1, pose.alpha);
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    ctx.translate(cx + pose.dx, cy + pose.dy);
    ctx.scale(pose.scale, pose.scale);
    ctx.translate(-cx, -cy);
    if (pose.clipFrom > 0 || pose.clipTo < 1) {
      ctx.beginPath();
      ctx.rect(area.x + pose.clipFrom * area.w, -rc.height, (pose.clipTo - pose.clipFrom) * area.w, rc.height * 3);
      ctx.clip();
    }
    const drawn = drawLayer(ctx, layer, area, pose, rc, note);
    ctx.restore();
    if (drawn) report.drawn.push(layer.id);
  }
}

/**
 * Draws frame number `frame` (0-based, 30 fps) of a graphic. The canvas is cleared first and stays transparent
 * wherever nothing is drawn. Preview (normal canvas) and export (OffscreenCanvas) call this same function.
 */
export function renderFrame(spec: GraphicSpec, frame: number, ctx: Canvas2D, rc: RenderContext, options: RenderOptions = {}): FrameReport {
  const report: FrameReport = { drawn: [], notes: [] };
  const samples = Math.max(1, Math.floor(options.motionBlurSamples ?? 1));
  if (samples === 1 || !rc.createScratch) {
    draw(spec, frame, ctx, rc, report);
    return report;
  }
  const shutter = Math.min(1, Math.max(0, options.shutter ?? 0.5));
  const scratch = rc.createScratch();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, rc.width, rc.height);
  for (let i = 0; i < samples; i++) {
    const sub: FrameReport = { drawn: [], notes: [] };
    draw(spec, frame + shutter * ((i + 0.5) / samples - 0.5), scratch.ctx, rc, sub);
    if (i === 0) report.drawn.push(...sub.drawn);
    report.notes.push(...sub.notes.filter((n) => !report.notes.some((x) => x.layerId === n.layerId && x.kind === n.kind)));
    // "lighter" adds the premultiplied colours, so the sum of n samples with weight 1/n is their mean.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 / samples;
    ctx.drawImage(scratch.canvas, 0, 0);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  return report;
}
