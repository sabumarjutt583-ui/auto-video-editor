import type { MapView } from "./projections.ts";

const RAD = Math.PI / 180;

export interface LonLat {
  lat: number;
  lon: number;
}

/** Points along the shortest path over the globe between two places (spherical interpolation). */
export function greatCircle(a: LonLat, b: LonLat, steps = 64): LonLat[] {
  const toVec = (p: LonLat): [number, number, number] => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [a, b];
  const out: LonLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const x = s1 * va[0] + s2 * vb[0];
    const y = s1 * va[1] + s2 * vb[1];
    const z = s1 * va[2] + s2 * vb[2];
    out.push({ lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD });
  }
  return out;
}

/** A route in pixels: separate pieces where the line leaves the picture (across the date line, behind a globe). */
export type Polyline = Array<[number, number]>;

export function routePixels(view: MapView, a: LonLat, b: LonLat, steps = 64): Polyline[] {
  const pieces: Polyline[] = [];
  let current: Polyline = [];
  let previousLon: number | null = null;
  for (const p of greatCircle(a, b, steps)) {
    const xy = view.project(p.lon, p.lat);
    // A jump of more than half the world in longitude is the line wrapping round the date line.
    const wrapped = previousLon !== null && Math.abs(p.lon - previousLon) > 180 && view.kind !== "orthographic";
    previousLon = p.lon;
    if (!xy || wrapped) {
      if (current.length > 1) pieces.push(current);
      current = xy ? [xy] : [];
    } else {
      current.push(xy);
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

export function polylineLength(pieces: readonly Polyline[]): number {
  let total = 0;
  for (const piece of pieces) for (let i = 1; i < piece.length; i++) total += Math.hypot((piece[i] as [number, number])[0] - (piece[i - 1] as [number, number])[0], (piece[i] as [number, number])[1] - (piece[i - 1] as [number, number])[1]);
  return total;
}

/** The first `fraction` (0..1) of the length of the pieces, cut exactly at that length. Also returns where the line ends (for a moving dot). */
export function trimPolylines(pieces: readonly Polyline[], fraction: number): { pieces: Polyline[]; end: [number, number] | null } {
  const limit = polylineLength(pieces) * Math.max(0, Math.min(1, fraction));
  const out: Polyline[] = [];
  let used = 0;
  let end: [number, number] | null = null;
  for (const piece of pieces) {
    const kept: Polyline = [piece[0] as [number, number]];
    for (let i = 1; i < piece.length; i++) {
      const p0 = piece[i - 1] as [number, number];
      const p1 = piece[i] as [number, number];
      const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (used + length >= limit) {
        const t = length === 0 ? 0 : (limit - used) / length;
        end = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
        kept.push(end);
        out.push(kept);
        return { pieces: out, end };
      }
      used += length;
      kept.push(p1);
      end = p1;
    }
    out.push(kept);
  }
  return { pieces: out, end };
}
