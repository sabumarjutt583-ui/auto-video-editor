import { clamp01, ease, type EasingName } from "./easing.ts";
import type { GraphicSpec, Layer } from "../spec/schema.ts";

/** Frame rate of every graphic. */
export const FPS = 30;
const EPS = 1e-6;

export const frameCount = (duration: number): number => Math.max(1, Math.round(duration * FPS));
export const frameTime = (frame: number): number => frame / FPS;

export interface LayerTiming {
  visible: boolean;
  /** Seconds since the layer started. */
  local: number;
  /** 0..1 eased progress of the entrance (1 = fully in, also 1 when there is no entrance). */
  enter: number;
  /** 0..1 eased progress of the exit (0 = not leaving yet). */
  exit: number;
  /** Seconds the layer is shown. */
  length: number;
}

/** When a layer is on screen, and how far its entrance and exit are, at time `t` (seconds). */
export function layerTiming(layer: Layer, specDuration: number, t: number): LayerTiming {
  const start = layer.start;
  const length = layer.duration ?? Math.max(0, specDuration - start);
  const end = start + length;
  const local = t - start;
  const visible = t >= start - EPS && t < end - EPS;
  if (!visible) return { visible: false, local, enter: 0, exit: 0, length };

  let enter = 1;
  const inn = layer.enter;
  if (inn && inn.preset !== "none") {
    const raw = inn.duration <= 0 ? (local >= inn.delay - EPS ? 1 : 0) : (local - inn.delay) / inn.duration;
    enter = ease((inn.easing ?? "easeOut") as EasingName, clamp01(raw));
  }
  let exit = 0;
  const out = layer.exit;
  if (out && out.preset !== "none" && out.duration > 0) {
    const raw = (t - (end - out.duration)) / out.duration;
    exit = ease((out.easing ?? "easeInOut") as EasingName, clamp01(raw));
  }
  return { visible: true, local, enter, exit, length };
}

/** Layers on screen at a frame, for tests and quality checks. */
export function visibleLayers(spec: GraphicSpec, frame: number): Layer[] {
  const t = frameTime(frame);
  return spec.layers.filter((layer) => layerTiming(layer, spec.duration, t).visible);
}
