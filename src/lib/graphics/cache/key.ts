import { FPS } from "../render/timing.ts";
import type { Theme } from "../render/theme.ts";
import { RENDERER_VERSION } from "../spec/limits.ts";
import type { GraphicSpec } from "../spec/schema.ts";

/** Bump when the bundled icons, flags or maps change (their pictures are part of every key). */
export const ASSETS_VERSION = 1;

/** JSON with sorted object keys, so equal values always give the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface KeyParts {
  spec: GraphicSpec;
  /** The brand kit as the renderer sees it (with the graphic's own colours already applied). */
  theme: Theme;
  /** The font files the graphic uses. */
  fonts: readonly string[];
  width: number;
  height: number;
  fps?: number;
}

/** A graphic that shows a picture file of the project cannot be cached by its text alone (the file may change). */
export function cacheable(spec: GraphicSpec): boolean {
  return !spec.layers.some((l) => l.type === "image");
}

/** SHA-256 (64 hex characters) of everything that changes the drawn picture. The graphic's id and name do not count. */
export async function cacheKey(parts: KeyParts): Promise<string> {
  const { id: _id, name: _name, ...spec } = parts.spec as GraphicSpec & { name?: string };
  const text = stableJson({ spec, theme: parts.theme, fonts: [...parts.fonts].sort(), renderer: RENDERER_VERSION, assets: ASSETS_VERSION, width: parts.width, height: parts.height, fps: parts.fps ?? FPS });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
