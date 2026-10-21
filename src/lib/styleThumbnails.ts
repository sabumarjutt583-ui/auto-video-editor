import type { StyleProfile } from "../types/style.ts";
import { byPopularity, CATEGORIES, isComplete } from "./styleModel.ts";

import { thumbnailSubject } from "./styleThumbnailSubjects.ts";

/** "C:\\pics\\Noir.PNG" becomes "noir": the file name without folders and extension, in lower case. */
export function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim().toLowerCase();
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface ThumbnailMatch {
  /** The path as it was given. */
  file: string;
  id: string;
}

export interface ThumbnailMatches {
  matched: ThumbnailMatch[];
  /** File names that match no style. */
  unmatched: string[];
  /** File names that match a style which already got a picture from an earlier file. */
  duplicates: string[];
}

/** Matches picture files to style ids by name (case-insensitive, extension ignored; spaces and dashes count as "_"). */
export function matchThumbnailFiles(files: readonly string[], ids: readonly string[]): ThumbnailMatches {
  const byLower = new Map(ids.map((id) => [id.toLowerCase(), id]));
  const result: ThumbnailMatches = { matched: [], unmatched: [], duplicates: [] };
  const taken = new Set<string>();
  for (const file of files) {
    const stem = fileStem(file);
    const id = byLower.get(stem) ?? byLower.get(stem.replace(/[\s-]+/g, "_"));
    if (id === undefined) result.unmatched.push(fileName(file));
    else if (taken.has(id)) result.duplicates.push(fileName(file));
    else {
      taken.add(id);
      result.matched.push({ file, id });
    }
  }
  return result;
}

/** One line for an image generator (each style has a subject that suits it): `<id>.png | <prompt>`. */
export function thumbnailPromptLine(style: StyleProfile): string {
  return `${style.id}.png | ${thumbnailSubject(style.id)}, ${style.style_lock}, clean image without any text or watermark, 4:3`;
}

/** The text of docs/thumbnail-prompts.txt: one line for every complete style, in picker order. */
export function thumbnailPromptsText(styles: readonly StyleProfile[]): string {
  const order = (list: readonly StyleProfile[]) => [...CATEGORIES].flatMap((category) => list.filter((s) => s.category === category).sort(byPopularity));
  return `${order(styles.filter(isComplete)).map(thumbnailPromptLine).join("\n")}\n`;
}

const NEUTRAL: readonly [string, string] = ["#4b4570", "#1f1b33"];

/** Colour words that can appear in a palette text, and a matching colour. Longer phrases come first. */
const COLOR_WORDS: readonly (readonly [string, string])[] = [
  ["baby pink", "#f4b6c8"], ["hot pink", "#ff4fa3"], ["deep navy", "#14213d"], ["burnt umber", "#6b3a1e"], ["raw sienna", "#a0522d"],
  ["sky blue", "#5aa9e6"], ["forest green", "#1f5f3a"], ["dusty gold", "#c9a24b"], ["tarnished gold", "#a88b3d"], ["steel grey", "#7b8794"],
  ["pale gold", "#e6cf8a"], ["misty blue", "#9db8d6"], ["warm amber", "#e0902b"], ["blood red", "#8b1a1a"],
  ["indigo", "#3f3d9e"], ["navy", "#14213d"], ["teal", "#1a8a8a"], ["cyan", "#22c7d6"], ["magenta", "#d11fa0"], ["purple", "#7a3fb5"],
  ["violet", "#7f5af0"], ["lavender", "#b8a6e8"], ["pink", "#f06fa4"], ["rose", "#e0587e"], ["coral", "#f2745c"], ["orange", "#f08a24"],
  ["amber", "#e0902b"], ["ochre", "#c98a1e"], ["mustard", "#d6a21e"], ["yellow", "#f2c935"], ["gold", "#d4a82f"], ["champagne", "#e8d3a2"],
  ["brass", "#b5883a"], ["copper", "#b4662f"], ["bronze", "#9a6b2f"], ["brown", "#7a4a2a"], ["umber", "#6b3a1e"], ["sepia", "#8a6a3e"],
  ["beige", "#d9c7a6"], ["peach", "#f6b894"], ["cream", "#f1e7cf"], ["red", "#d03a3a"], ["crimson", "#a3162f"], ["burgundy", "#6e1a2f"],
  ["green", "#3f9a55"], ["mint", "#8fd9b6"], ["olive", "#7d7a2e"], ["sage", "#9bb08b"], ["moss", "#6b7a3a"], ["emerald", "#1f9d6b"],
  ["blue", "#3b6fd1"], ["cobalt", "#2a52be"], ["cerulean", "#2f8fc9"], ["turquoise", "#2cc5b5"], ["grey", "#7f858c"], ["gray", "#7f858c"],
  ["charcoal", "#2f3338"], ["slate", "#56606b"], ["silver", "#b9c0c8"], ["black", "#15151a"], ["white", "#e9e9ee"],
];

/** Two colours for a placeholder, taken from the colour words of a palette text. A neutral pair when fewer than two are named. */
export function placeholderColors(palette: string): [string, string] {
  const text = palette.toLowerCase();
  const found: { at: number; hex: string }[] = [];
  const used: [number, number][] = [];
  for (const [word, hex] of COLOR_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "g");
    let match = re.exec(text);
    while (match) {
      const range: [number, number] = [match.index, match.index + word.length];
      if (!used.some(([a, b]) => range[0] < b && range[1] > a)) {
        used.push(range);
        found.push({ at: match.index, hex });
      }
      match = re.exec(text);
    }
  }
  const colors = found.sort((a, b) => a.at - b.at).map((c) => c.hex).filter((hex, i, all) => all.indexOf(hex) === i);
  return colors.length >= 2 ? [colors[0] ?? NEUTRAL[0], colors[1] ?? NEUTRAL[1]] : [...NEUTRAL];
}

export type ThumbnailView =
  | { kind: "image"; src: string }
  | { kind: "placeholder"; letter: string; from: string; to: string };

/**
 * What a card shows: the picture, or a generated placeholder when the style has no picture or the picture
 * could not be loaded. `toUrl` turns a file path into an address the web view can load.
 */
export function thumbnailView(style: Pick<StyleProfile, "name" | "thumbnail" | "color_palette">, imageFailed: boolean, toUrl: (path: string) => string): ThumbnailView {
  if (style.thumbnail.trim() !== "" && !imageFailed) return { kind: "image", src: toUrl(style.thumbnail) };
  const [from, to] = placeholderColors(style.color_palette);
  const letter = [...style.name.trim()][0]?.toUpperCase() ?? "?";
  return { kind: "placeholder", letter, from, to };
}

/** Warnings (not errors) about pictures: ids without a picture file, and profiles that name a missing file. */
export function thumbnailWarnings(styles: readonly Pick<StyleProfile, "id" | "thumbnail">[], files: ReadonlySet<string>): string[] {
  const warnings: string[] = [];
  const missing = styles.filter((s) => !files.has(`${s.id}.webp`)).map((s) => s.id);
  if (missing.length > 0) warnings.push(`${missing.length} of ${styles.length} styles have no thumbnail yet (a placeholder is shown): ${missing.join(", ")}`);
  for (const s of styles) {
    if (s.thumbnail.trim() !== "" && !files.has(s.thumbnail.replace(/^thumbnails\//, ""))) warnings.push(`${s.id}: its thumbnail field names a file that does not exist (${s.thumbnail})`);
  }
  return warnings;
}
