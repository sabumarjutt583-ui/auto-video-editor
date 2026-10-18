import { convertFileSrc } from "@tauri-apps/api/core";

import { fontsDir } from "./api";
import type { FontInfo } from "./fonts";

const loading = new Map<string, Promise<boolean>>();

async function addFace(family: string, dir: string, file: string, weight: string): Promise<void> {
  const separator = dir.includes("\\") ? "\\" : "/";
  const url = convertFileSrc(`${dir}${separator}${file}`);
  const face = new FontFace(family, `url("${url}")`, { weight });
  await face.load();
  document.fonts.add(face);
}

/** Loads a bundled font (regular and bold) into the webview, so the preview shows real glyphs. True when it worked. */
export function loadFont(font: FontInfo): Promise<boolean> {
  const existing = loading.get(font.id);
  if (existing) return existing;
  const task = (async () => {
    try {
      const dir = await fontsDir();
      await Promise.all([addFace(font.family, dir, font.regular, "400"), addFace(font.family, dir, font.bold, "700")]);
      return true;
    } catch {
      loading.delete(font.id);
      return false;
    }
  })();
  loading.set(font.id, task);
  return task;
}
