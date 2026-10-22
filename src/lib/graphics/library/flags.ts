import { COUNTRIES } from "./countries.ts";

/**
 * Flag pictures (flag-icons, MIT): one 480x360 lossless WebP per ISO 3166-1 alpha-2 code, with a transparent background where the flag
 * is not a full rectangle (Nepal). They are made by scripts/build-flags.mjs. This file needs the Vite bundler (`import.meta.glob`).
 */
const files = import.meta.glob("../assets/flags/*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const urls = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const code = /([a-z]{2})\.webp$/.exec(path)?.[1];
  if (code) urls.set(code.toUpperCase(), url);
}

/** Codes that have a flag picture. */
export const FLAG_CODES: readonly string[] = COUNTRIES.map((c) => c.a2).filter((code) => urls.has(code));

export function hasFlag(code: string): boolean {
  return urls.has(code.toUpperCase());
}

export function flagUrl(code: string): string | undefined {
  return urls.get(code.toUpperCase());
}

/** Key of a flag in the picture map of a render context. */
export const flagKey = (code: string): string => `flag:${code.toUpperCase()}`;

/** The flags a spec uses (flag layers). */
export function flagCodesOf(spec: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "flag" && typeof record.country === "string") found.add(record.country.toUpperCase());
      for (const child of Object.values(record)) walk(child);
    }
  };
  walk(spec);
  return [...found];
}

/** Decodes the flags of a spec into bitmaps keyed by `flagKey`. A flag that cannot be loaded is left out (the renderer notes it). */
export async function loadFlagBitmaps(codes: readonly string[]): Promise<Record<string, ImageBitmap>> {
  const out: Record<string, ImageBitmap> = {};
  await Promise.all(
    codes.map(async (code) => {
      const url = flagUrl(code);
      if (!url) return;
      try {
        const response = await fetch(url);
        if (response.ok) out[flagKey(code)] = await createImageBitmap(await response.blob());
      } catch {
        // Left out on purpose.
      }
    }),
  );
  return out;
}
