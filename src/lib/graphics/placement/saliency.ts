import { clampBox, type Box } from "./geometry.ts";

export interface Subject {
  box: Box;
  /** 0..1: how clearly one area stands out. */
  confidence: number;
  source: "ai" | "saliency";
}

/**
 * A simple local guess of where the main subject is, from a small grey picture (values 0..255, row by row): edges and contrast
 * with a pull towards the middle, the strongest quarter of the picture, trimmed to its core. Returns null for a flat picture.
 * No randomness: the same pixels give the same box.
 */
export function findSubject(gray: ArrayLike<number>, width: number, height: number): Subject | null {
  if (width < 8 || height < 8 || gray.length < width * height) return null;
  const at = (x: number, y: number): number => gray[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] as number;
  const energy = new Float64Array(width * height);
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const dx = (x + 0.5) / width - 0.5;
      const dy = (y + 0.5) / height - 0.5;
      const pull = Math.exp(-(dx * dx + dy * dy) / (2 * 0.35 * 0.35));
      const e = Math.hypot(gx, gy) * (0.45 + 0.55 * pull);
      energy[y * width + x] = e;
      total += e;
    }
  }
  if (total / (width * height) < 4) return null;
  // Blur a little (box 3x3) so single noisy pixels do not count.
  const blurred = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height) { sum += energy[yy * width + xx] as number; n++; }
      }
      blurred[y * width + x] = sum / n;
    }
  }
  const sorted = [...blurred].sort((a, b) => a - b);
  const cut = sorted[Math.floor(sorted.length * 0.75)] as number;
  const columns = new Float64Array(width);
  const rows = new Float64Array(height);
  let strong = 0, all = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = blurred[y * width + x] as number;
      all += e;
      if (e >= cut && e > 0) { columns[x] = (columns[x] as number) + e; rows[y] = (rows[y] as number) + e; strong += e; }
    }
  }
  if (strong <= 0) return null;
  const trimmed = (sums: Float64Array, size: number): [number, number] => {
    let acc = 0, lo = 0, hi = size - 1;
    for (let i = 0; i < size; i++) { acc += sums[i] as number; if (acc >= strong * 0.04) { lo = i; break; } }
    acc = 0;
    for (let i = size - 1; i >= 0; i--) { acc += sums[i] as number; if (acc >= strong * 0.04) { hi = i; break; } }
    return [lo, Math.max(lo, hi)];
  };
  const [x0, x1] = trimmed(columns, width);
  const [y0, y1] = trimmed(rows, height);
  const pad = 0.02;
  const box = clampBox({ x: x0 / width - pad, y: y0 / height - pad, w: (x1 + 1 - x0) / width + 2 * pad, h: (y1 + 1 - y0) / height + 2 * pad });
  // Confidence: how much of the strong energy sits in the box, and how small the box is (a box of the whole picture says little).
  const share = strong / Math.max(1, all);
  const compact = 1 - Math.min(1, (box.w * box.h));
  return { box, confidence: Math.round(Math.min(1, share * 2.2) * (0.4 + 0.6 * compact) * 100) / 100, source: "saliency" };
}

/** Grey values (0..255) of RGBA pixels, row by row. */
export function grayOf(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * (rgba[i * 4] as number) + 0.587 * (rgba[i * 4 + 1] as number) + 0.114 * (rgba[i * 4 + 2] as number));
  return out;
}
