import { FONTS } from "../../captions/fonts.ts";
import { loadFont } from "../../captions/loadFonts.ts";
import type { RenderContext } from "./context.ts";
import { iconShape } from "../library/icons.ts";
import { DEFAULT_THEME } from "./theme.ts";

/** Loads every bundled font into the webview (once). The renderer measures text with them, so call this before drawing. */
export async function loadGraphicFonts(): Promise<boolean> {
  const results = await Promise.all(FONTS.map((font) => loadFont(font)));
  await document.fonts.ready;
  return results.every(Boolean);
}

/**
 * A render context for a visible canvas (the live preview). Pictures are looked up in `images` by the layer `src`; flags are
 * in the same map under `flag:XX`. Icons come from the loaded sets (call `ensureIcons` first).
 */
export function previewContext(width: number, height: number, images: ReadonlyMap<string, CanvasImageSource>): RenderContext {
  return {
    width,
    height,
    theme: DEFAULT_THEME,
    image: (src) => images.get(src),
    icon: iconShape,
    flag: (code) => images.get(`flag:${code.toUpperCase()}`),
  };
}

export type PreviewSize = { width: number; height: number };

/** Canvas size of the preview for a project picture shape. */
export function previewSize(aspect: "16:9" | "9:16" | "1:1"): PreviewSize {
  return aspect === "9:16" ? { width: 540, height: 960 } : aspect === "1:1" ? { width: 720, height: 720 } : { width: 960, height: 540 };
}
