import type { CaptionData, CaptionFont, CaptionLine, CaptionPosition, CaptionPreset, CaptionStyle, CaptionWord } from "../../types/editor.ts";
import { DEFAULT_CAPTION_STYLE } from "./presets.ts";

type Obj = Record<string, unknown>;

const PRESET_IDS: readonly CaptionPreset[] = ["clean", "highlight", "pop", "boxed", "documentary", "none"];
const POSITIONS: readonly CaptionPosition[] = ["bottom", "middle", "top"];
const FONT_IDS: readonly CaptionFont[] = ["auto", "noto_sans", "noto_kr", "noto_jp", "noto_sc", "noto_devanagari", "noto_arabic"];

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function readWord(value: unknown): CaptionWord | null {
  if (!isObject(value) || typeof value.text !== "string" || typeof value.start !== "number" || typeof value.end !== "number") return null;
  return { text: value.text, start: value.start, end: value.end };
}

function readLine(value: unknown, index: number): CaptionLine | null {
  if (!isObject(value) || typeof value.text !== "string" || typeof value.start !== "number" || typeof value.end !== "number" || !Array.isArray(value.words)) return null;
  const words = value.words.map(readWord).filter((w): w is CaptionWord => w !== null);
  if (words.length === 0) return null;
  const breakAt = typeof value.breakAt === "number" && value.breakAt > 0 && value.breakAt < words.length ? value.breakAt : null;
  return { id: typeof value.id === "string" ? value.id : `C${String(index + 1).padStart(3, "0")}`, start: value.start, end: value.end, text: value.text, words, breakAt };
}

export function readStyle(value: unknown): CaptionStyle {
  const o = isObject(value) ? value : {};
  const d = DEFAULT_CAPTION_STYLE;
  return {
    preset: pick(o.preset, PRESET_IDS, d.preset),
    font: pick(o.font, FONT_IDS, d.font),
    fontSize: number(o.fontSize, 2, 14, d.fontSize),
    primary: color(o.primary, d.primary),
    highlight: color(o.highlight, d.highlight),
    outline: number(o.outline, 0, 8, d.outline),
    shadow: number(o.shadow, 0, 8, d.shadow),
    position: pick(o.position, POSITIONS, d.position),
    uppercase: o.uppercase === true,
  };
}

/** The caption settings of a project, with every missing or damaged part replaced by its default. */
export function readCaptions(value: unknown): CaptionData {
  const o = isObject(value) ? value : {};
  const lines = Array.isArray(o.lines) ? o.lines.map(readLine).filter((l): l is CaptionLine => l !== null) : null;
  return { style: readStyle(o.style), lines: lines && lines.length > 0 ? lines : null };
}
