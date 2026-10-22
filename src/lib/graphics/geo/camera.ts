import { ease } from "../render/easing.ts";
import type { Camera } from "./projections.ts";
import { NO_CAMERA } from "./projections.ts";

export interface CameraKey {
  t: number;
  zoom: number;
  panX: number;
  panY: number;
}

/** The camera `t` seconds after the layer started: held before the first and after the last key, smooth in between. */
export function cameraAt(keys: readonly CameraKey[], t: number): Camera {
  if (keys.length === 0) return NO_CAMERA;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const first = sorted[0] as CameraKey;
  const last = sorted[sorted.length - 1] as CameraKey;
  if (t <= first.t) return { zoom: first.zoom, panX: first.panX, panY: first.panY };
  if (t >= last.t) return { zoom: last.zoom, panX: last.panX, panY: last.panY };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as CameraKey;
    const b = sorted[i] as CameraKey;
    if (t <= b.t) {
      const k = b.t === a.t ? 1 : ease("easeInOut", (t - a.t) / (b.t - a.t));
      // Zoom is blended on a log scale so a zoom from 1 to 4 feels even.
      return { zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * k), panX: a.panX + (b.panX - a.panX) * k, panY: a.panY + (b.panY - a.panY) * k };
    }
  }
  return { zoom: last.zoom, panX: last.panX, panY: last.panY };
}
