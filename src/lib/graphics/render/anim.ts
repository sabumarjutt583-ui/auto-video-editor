import type { Layer } from "../spec/schema.ts";
import { clamp01 } from "./easing.ts";
import type { LayerTiming } from "./timing.ts";

/** What the entrance and exit do to a layer at one moment. */
export interface Pose {
  alpha: number;
  /** Move in pixels. */
  dx: number;
  dy: number;
  /** Scale around the middle of the layer box. */
  scale: number;
  /** Visible part of the box, from `clipFrom` to `clipTo` (0..1, left to right). */
  clipFrom: number;
  clipTo: number;
  /** Share of the characters shown (typewriter), 1 = all. */
  reveal: number;
}

const SLIDE_X = 0.06;
const SLIDE_Y = 0.05;

/** Entrance and exit presets (spec `enter.preset` and `exit.preset`) turned into one pose. Pure. */
export function poseOf(layer: Layer, timing: LayerTiming, canvasW: number, canvasH: number): Pose {
  const pose: Pose = { alpha: layer.opacity, dx: 0, dy: 0, scale: 1, clipFrom: 0, clipTo: 1, reveal: 1 };
  const e = timing.enter;
  const inn = layer.enter?.preset ?? "none";
  const hidden = 1 - e;
  switch (inn) {
    case "fade":
      pose.alpha *= clamp01(e);
      break;
    case "slideUp":
      pose.alpha *= clamp01(e);
      pose.dy = hidden * canvasH * SLIDE_Y;
      break;
    case "slideDown":
      pose.alpha *= clamp01(e);
      pose.dy = 0 - hidden * canvasH * SLIDE_Y;
      break;
    case "slideLeft":
      pose.alpha *= clamp01(e);
      pose.dx = hidden * canvasW * SLIDE_X;
      break;
    case "slideRight":
      pose.alpha *= clamp01(e);
      pose.dx = 0 - hidden * canvasW * SLIDE_X;
      break;
    case "scale":
      pose.alpha *= clamp01(e);
      pose.scale = 0.8 + 0.2 * e;
      break;
    case "pop":
      pose.alpha *= clamp01(e * 3);
      pose.scale = 0.6 + 0.4 * e;
      break;
    case "wipe":
      pose.clipTo = clamp01(e);
      break;
    case "typewriter":
      pose.reveal = clamp01(e);
      break;
    case "none":
      break;
  }
  const q = timing.exit;
  if (q > 0) {
    const out = layer.exit?.preset ?? "none";
    const keep = 1 - q;
    switch (out) {
      case "fade":
        pose.alpha *= clamp01(keep);
        break;
      case "slideUp":
        pose.alpha *= clamp01(keep);
        pose.dy -= q * canvasH * SLIDE_Y;
        break;
      case "slideDown":
        pose.alpha *= clamp01(keep);
        pose.dy += q * canvasH * SLIDE_Y;
        break;
      case "slideLeft":
        pose.alpha *= clamp01(keep);
        pose.dx -= q * canvasW * SLIDE_X;
        break;
      case "slideRight":
        pose.alpha *= clamp01(keep);
        pose.dx += q * canvasW * SLIDE_X;
        break;
      case "scale":
        pose.alpha *= clamp01(keep);
        pose.scale *= 1 - 0.2 * q;
        break;
      case "wipe":
        pose.clipFrom = Math.max(pose.clipFrom, clamp01(q));
        break;
      case "none":
        break;
    }
  }
  return pose;
}
