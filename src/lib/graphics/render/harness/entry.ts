/**
 * Browser entry for the golden-image tests (bundled to one script by scripts/graphics-harness.mjs and driven by the
 * Rust test in src-tauri/src/graphics/golden_tests.rs). It draws with exactly the code the app uses.
 */
import { loadCities } from "../../geo/cities.ts";
import { loadMapData } from "../../geo/mapData.ts";
import { FLAG_CODES, flagKey, loadFlagBitmaps } from "../../library/flags.ts";
import { ensureIcons, iconsOfSpec, iconShape } from "../../library/icons.ts";
import type { GeoAssets } from "./geoCases.ts";
import type { Canvas2D, RenderContext } from "../context.ts";
import { drawFlagPicture } from "../draw/geo.ts";
import { renderFrame } from "../renderFrame.ts";
import { DEFAULT_THEME } from "../theme.ts";
import { GOLDEN_CASES, GOLDEN_SIZE } from "./cases.ts";

const FONT_FILES: ReadonlyArray<readonly [string, string, string]> = [
  ["Noto Sans", "NotoSans-Regular.ttf", "400"], ["Noto Sans", "NotoSans-Bold.ttf", "700"],
  ["Noto Sans KR", "NotoSansKR-Regular.otf", "400"], ["Noto Sans KR", "NotoSansKR-Bold.otf", "700"],
  ["Noto Sans JP", "NotoSansJP-Regular.otf", "400"], ["Noto Sans JP", "NotoSansJP-Bold.otf", "700"],
  ["Noto Sans SC", "NotoSansSC-Regular.otf", "400"], ["Noto Sans SC", "NotoSansSC-Bold.otf", "700"],
  ["Noto Sans Devanagari", "NotoSansDevanagari-Regular.ttf", "400"], ["Noto Sans Devanagari", "NotoSansDevanagari-Bold.ttf", "700"],
  ["Noto Sans Arabic", "NotoSansArabic-Regular.ttf", "400"], ["Noto Sans Arabic", "NotoSansArabic-Bold.ttf", "700"],
];

/** A picture made in code: a colour gradient with a white corner mark (wide, so "cover" and "contain" differ). */
function testPicture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const gradient = ctx.createLinearGradient(0, 0, 200, 100);
  gradient.addColorStop(0, "#ef4444");
  gradient.addColorStop(1, "#3b82f6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 200, 100);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(10, 10, 30, 30);
  return canvas;
}

let assets: GeoAssets | null = null;

function context(width: number, height: number): RenderContext {
  const picture = testPicture();
  return {
    width,
    height,
    theme: DEFAULT_THEME,
    image: (src) => (src === "test.png" ? picture : undefined),
    icon: iconShape,
    flag: (code) => assets?.flags.get(code.toUpperCase()),
    createScratch: () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      return { ctx, canvas };
    },
  };
}

function drawCase(index: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; notes: string[] } {
  const item = GOLDEN_CASES[index];
  if (!item) throw new Error(`no case ${index}`);
  const canvas = document.createElement("canvas");
  canvas.width = GOLDEN_SIZE.width;
  canvas.height = GOLDEN_SIZE.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  if (item.custom) {
    if (!assets) throw new Error("call loadAssets() first");
    item.custom(ctx as Canvas2D, canvas.width, canvas.height, assets);
    return { canvas, ctx, notes: [] };
  }
  const report = renderFrame(item.spec, item.frame, ctx as Canvas2D, context(canvas.width, canvas.height), item.options);
  return { canvas, ctx, notes: report.notes.map((n) => `${n.layerId}:${n.kind}`) };
}

async function loadImage(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, { premultiplyAlpha: "none" });
}

interface Comparison {
  name: string;
  status: "same" | "different" | "no-golden";
  mae: number;
  bad: number;
  total: number;
  notes: string[];
  png: string;
}

const api = {
  async loadFonts(baseUrl: string): Promise<number> {
    let loaded = 0;
    for (const [family, file, weight] of FONT_FILES) {
      const face = new FontFace(family, `url("${baseUrl}${file}")`, { weight });
      await face.load();
      document.fonts.add(face);
      loaded++;
    }
    await document.fonts.ready;
    return loaded;
  },
  /** Loads the icon sets, every flag, both map resolutions and the cities (the harness bundle has them inlined). */
  async loadAssets(): Promise<{ flags: number; countries110: number; countries50: number; cities: number }> {
    await ensureIcons([{ set: "lucide", name: "" }, { set: "tabler", name: "" }]);
    const flagBitmaps = await loadFlagBitmaps(FLAG_CODES);
    const flags = new Map<string, ImageBitmap>();
    for (const code of FLAG_CODES) {
      const bitmap = flagBitmaps[flagKey(code)];
      if (bitmap) flags.set(code, bitmap);
    }
    const [map110, map50, cities] = await Promise.all([loadMapData("110m"), loadMapData("50m"), loadCities()]);
    assets = { map110, map50, cities, flags };
    return { flags: flags.size, countries110: map110.countries.length, countries50: map50.countries.length, cities: cities.length };
  },
  /** Draws every flag on its own canvas and reports the codes whose picture is empty or does not fill its 4:3 box. */
  flagProblems(): string[] {
    if (!assets) throw new Error("call loadAssets() first");
    const problems: string[] = [];
    for (const [code, bitmap] of assets.flags) {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 90;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      drawFlagPicture(ctx, bitmap, { x: 0, y: 0, w: 120, h: 90 }, "rect");
      const data = ctx.getImageData(0, 0, 120, 90).data;
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 200) painted++;
      if (painted < 120 * 90 * 0.3) problems.push(`${code}: only ${painted} pixels painted`);
    }
    return problems;
  },
  cases(): { name: string }[] {
    return GOLDEN_CASES.map((c) => ({ name: c.name }));
  },
  /** Draws a case and compares it with a golden PNG (data URL, or "" when there is none yet). */
  async compare(index: number, golden: string): Promise<Comparison> {
    const { canvas, ctx, notes } = drawCase(index);
    const name = GOLDEN_CASES[index]?.name ?? "";
    const png = canvas.toDataURL("image/png");
    if (golden === "") return { name, status: "no-golden", mae: 0, bad: 0, total: 0, notes, png };
    const bitmap = await loadImage(golden);
    const other = document.createElement("canvas");
    other.width = canvas.width;
    other.height = canvas.height;
    const otherCtx = other.getContext("2d", { willReadFrequently: true });
    if (!otherCtx) throw new Error("no 2d context");
    otherCtx.drawImage(bitmap, 0, 0);
    const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const b = otherCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let bad = 0;
    const total = canvas.width * canvas.height;
    for (let i = 0; i < a.length; i += 4) {
      // Premultiplied difference: a transparent pixel has no colour.
      const aa = (a[i + 3] ?? 0) / 255;
      const ba = (b[i + 3] ?? 0) / 255;
      let worst = Math.abs(aa - ba) * 255;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs((a[i + c] ?? 0) * aa - (b[i + c] ?? 0) * ba));
      sum += worst;
      if (worst > 40) bad++;
    }
    const mae = sum / total;
    return { name, status: mae <= 1.5 && bad / total <= 0.003 ? "same" : "different", mae, bad, total, notes, png };
  },
  /**
   * Draws every frame of a case in a real Web Worker (OffscreenCanvas, the code of the export) and on this page, and compares
   * the bytes. They must be identical: one renderer for preview and export.
   */
  async exportViaWorker(index: number, workerUrl: string, fontBaseUrl: string): Promise<{ frames: number; identical: number; maxDiff: number; bytes: number }> {
    const item = GOLDEN_CASES[index];
    if (!item) throw new Error(`no case ${index}`);
    const { width, height } = GOLDEN_SIZE;
    const fonts = [];
    for (const [family, file, weight] of FONT_FILES.slice(0, 2)) {
      fonts.push({ family, weight, data: await (await fetch(`${fontBaseUrl}${file}`)).arrayBuffer() });
    }
    const worker = new Worker(workerUrl);
    const waiting = new Map<number, (b: ArrayBuffer) => void>();
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: string; n?: number; buffer?: ArrayBuffer; message?: string }>) => {
        const m = event.data;
        if (m.type === "ready") resolve();
        else if (m.type === "frame" && m.n !== undefined && m.buffer) waiting.get(m.n)?.(m.buffer);
        else reject(new Error(m.message ?? "worker error"));
      };
      worker.onerror = (e) => reject(new Error(e.message));
    });
    worker.postMessage({ type: "init", spec: item.spec, width, height, fonts, images: {}, icons: await iconsOfSpec(item.spec) });
    await ready;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    const rc = context(width, height);
    const total = Math.round(item.spec.duration * 30);
    let identical = 0;
    let maxDiff = 0;
    let bytes = 0;
    for (let n = 0; n < total; n++) {
      const fromWorker = new Promise<ArrayBuffer>((resolve) => waiting.set(n, resolve));
      worker.postMessage({ type: "frame", n });
      const a = new Uint8ClampedArray(await fromWorker);
      renderFrame(item.spec, n, ctx as Canvas2D, rc);
      const b = ctx.getImageData(0, 0, width, height).data;
      bytes += a.length;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
      maxDiff = Math.max(maxDiff, diff);
      if (diff === 0) identical++;
    }
    worker.terminate();
    return { frames: total, identical, maxDiff, bytes };
  },
  /** Frame `n` of a case as raw RGBA bytes (straight alpha, as the export sends them), base64 text. */
  rawFrame(index: number, n: number): string {
    const item = GOLDEN_CASES[index];
    if (!item) throw new Error(`no case ${index}`);
    const canvas = document.createElement("canvas");
    canvas.width = GOLDEN_SIZE.width;
    canvas.height = GOLDEN_SIZE.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    renderFrame(item.spec, n, ctx as Canvas2D, context(canvas.width, canvas.height));
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let text = "";
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) text += String.fromCharCode(...data.subarray(i, i + chunk));
    return btoa(text);
  },
  /** The share of fully transparent pixels of a case (nothing is painted outside the layers). */
  transparentShare(index: number): number {
    const { canvas, ctx } = drawCase(index);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear++;
    return clear / (canvas.width * canvas.height);
  },
};

declare global {
  interface Window {
    __graphics: typeof api;
  }
}
window.__graphics = api;
