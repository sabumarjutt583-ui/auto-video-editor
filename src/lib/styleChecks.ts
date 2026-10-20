import { isComplete, missingFields } from "./styleModel.ts";
import type { StyleProfile } from "../types/style.ts";

/** Names that must never appear in a style (fields or display name). Lower case. */
export const BANNED_NAMES: readonly string[] = ["pixar", "disney", "ghibli", "marvel", "dreamworks", "dc comics"];

const ASPECT_PATTERN = /(\d+\s*:\s*\d+|--ar\b)/i;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Splits a comma-separated list into trimmed, non-empty items. */
export function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

const TEXT_KEYS = [
  "name",
  "category",
  "core_identity",
  "medium",
  "lighting",
  "color_palette",
  "camera",
  "composition",
  "texture",
  "characters",
  "mood",
  "negative",
  "motion_rules",
  "style_lock",
  "example_prompt",
] as const;

/** Banned names found in the display name and every text field. */
export function bannedHits(style: StyleProfile, banned: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const key of TEXT_KEYS) {
    const value = style[key].toLowerCase();
    for (const name of banned) {
      const word = name.trim().toLowerCase();
      if (word !== "" && value.includes(word)) hits.add(`${word} (in ${key})`);
    }
  }
  const id = style.id.toLowerCase();
  for (const name of banned) {
    const word = name.trim().toLowerCase().replace(/\s+/g, "_");
    if (word !== "" && id.includes(word)) hits.add(`${word} (in id)`);
  }
  return [...hits];
}

/** Problems of a COMPLETE style against the writing rules. Empty list = passes. */
export function completeProblems(style: StyleProfile, fileName: string, banned: readonly string[]): string[] {
  const problems: string[] = [];
  const lock = splitList(style.style_lock);
  const negative = splitList(style.negative);
  const mood = splitList(style.mood);

  if (lock.length < 12 || lock.length > 25) problems.push(`style_lock has ${lock.length} items (need 12-25)`);
  if (ASPECT_PATTERN.test(style.style_lock)) problems.push("style_lock contains an aspect ratio");
  if (negative.length < 12 || negative.length > 25) problems.push(`negative has ${negative.length} items (need 12-25)`);
  const lockSet = new Set(lock.map((item) => item.toLowerCase()));
  const shared = negative.filter((item) => lockSet.has(item.toLowerCase()));
  if (shared.length > 0) problems.push(`negative and style_lock share: ${shared.join(", ")}`);
  if (!style.example_prompt.trim().endsWith(style.style_lock.trim())) problems.push("example_prompt does not end with style_lock");
  const words = wordCount(style.example_prompt);
  if (words < 60 || words > 100) problems.push(`example_prompt has ${words} words (need 60-100)`);
  if (mood.length < 4 || mood.length > 6) problems.push(`mood has ${mood.length} items (need 4-6)`);
  if (!SEMVER.test(style.version)) problems.push(`version "${style.version}" is not like 1.0.0`);
  problems.push(...idProblems(style, fileName));
  for (const hit of bannedHits(style, banned)) problems.push(`banned name: ${hit}`);
  return problems;
}

/** The id must be lowercase snake case and equal the file name (without .json). */
export function idProblems(style: StyleProfile, fileName: string): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9_]+$/.test(style.id)) problems.push(`id "${style.id}" must use lowercase letters, digits and underscores`);
  if (`${style.id}.json` !== fileName) problems.push(`id "${style.id}" does not match file name ${fileName}`);
  return problems;
}

export interface StyleReport {
  id: string;
  name: string;
  complete: boolean;
  problems: string[];
}

/** One report row per style. Incomplete styles list their missing fields (and id / name problems). */
export function reportStyles(files: readonly { fileName: string; style: StyleProfile }[], banned: readonly string[]): StyleReport[] {
  const counts = new Map<string, number>();
  for (const { style } of files) counts.set(style.id, (counts.get(style.id) ?? 0) + 1);
  return files.map(({ fileName, style }) => {
    const complete = isComplete(style);
    const problems = complete
      ? completeProblems(style, fileName, banned)
      : [`missing: ${missingFields(style).length} fields`, ...idProblems(style, fileName), ...bannedHits(style, banned).map((hit) => `banned name: ${hit}`)];
    if ((counts.get(style.id) ?? 0) > 1) problems.push(`id "${style.id}" is used more than once`);
    return { id: style.id, name: style.name, complete, problems };
  });
}

/** Plain-text table: style name, status, problems. */
export function formatReportTable(reports: readonly StyleReport[]): string {
  const rows = reports.map((r) => [r.name || r.id, r.complete ? (r.problems.length ? "complete (with problems)" : "complete") : "incomplete", r.problems.join("; ") || "-"]);
  const header = ["Style", "Status", "Problems"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  const complete = reports.filter((r) => r.complete).length;
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line), "", `${complete} complete, ${reports.length - complete} incomplete`].join("\n");
}

/** Reads a style JSON file the way the app does: absent text fields count as empty. */
export function normalizeStyle(raw: Partial<Record<keyof StyleProfile, unknown>>): StyleProfile {
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    id: text(raw.id),
    name: text(raw.name),
    category: text(raw.category),
    version: text(raw.version),
    core_identity: text(raw.core_identity),
    medium: text(raw.medium),
    lighting: text(raw.lighting),
    color_palette: text(raw.color_palette),
    camera: text(raw.camera),
    composition: text(raw.composition),
    texture: text(raw.texture),
    characters: text(raw.characters),
    mood: text(raw.mood),
    negative: text(raw.negative),
    motion_rules: text(raw.motion_rules),
    style_lock: text(raw.style_lock),
    example_prompt: text(raw.example_prompt),
    thumbnail: text(raw.thumbnail),
    builtin: true,
  };
}
