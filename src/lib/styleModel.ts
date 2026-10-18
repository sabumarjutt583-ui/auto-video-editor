import type { StyleProfile, StyleTextField } from "../types/style.ts";

export const CATEGORIES = [
  "Cinematic & Film",
  "Realistic",
  "Animation & Cartoon",
  "Comic & Story",
  "Painting",
  "Drawing & Sketch",
  "Flat & Graphic",
  "Fantasy & Sci-Fi",
  "Artistic Mood",
  "Commercial",
  "Educational & Science",
] as const;

/** The fields that must be filled before a style can be used for generation, with their labels. */
export const REQUIRED_FIELDS: readonly { key: StyleTextField; label: string; hint: string }[] = [
  { key: "core_identity", label: "Core identity", hint: "What this style is, in a few sentences." },
  { key: "medium", label: "Medium", hint: "What it looks like it was made with." },
  { key: "lighting", label: "Lighting", hint: "Light sources, contrast, time of day." },
  { key: "color_palette", label: "Color palette", hint: "Dominant colors and how saturated they are." },
  { key: "camera", label: "Camera", hint: "Lenses, angles, depth of field." },
  { key: "composition", label: "Composition", hint: "Framing and layout rules." },
  { key: "texture", label: "Texture", hint: "Surface detail, grain, brush marks." },
  { key: "characters", label: "Characters", hint: "How people and faces are drawn." },
  { key: "mood", label: "Mood", hint: "The feeling of the pictures." },
  { key: "negative", label: "Negative", hint: "Things that must NOT appear, separated by commas." },
  { key: "motion_rules", label: "Motion rules", hint: "How the camera and subjects may move in video." },
  { key: "style_lock", label: "Style lock", hint: "A short phrase added to the end of every prompt." },
  { key: "example_prompt", label: "Example prompt", hint: "One sample prompt in this style." },
];

/** Labels of the required fields that are still empty. */
export function missingFields(style: StyleProfile): string[] {
  return REQUIRED_FIELDS.filter(({ key }) => style[key].trim() === "").map(({ label }) => label);
}

/** A style can be used for generation only when every required field is filled. */
export function isComplete(style: StyleProfile): boolean {
  return missingFields(style).length === 0;
}

export interface StyleGroup {
  category: string;
  styles: StyleProfile[];
}

function matches(style: StyleProfile, query: string): boolean {
  if (query === "") return true;
  const haystack = `${style.name} ${style.category} ${style.id.replace(/_/g, " ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((part) => haystack.includes(part));
}

/** Styles filtered by a search text and grouped by category (the 11 known categories first, in order). */
export function groupStyles(styles: readonly StyleProfile[], query = ""): StyleGroup[] {
  const filtered = styles.filter((style) => matches(style, query.trim()));
  const known: string[] = [...CATEGORIES];
  const extra = [...new Set(filtered.map((s) => s.category))].filter((c) => !known.includes(c)).sort();
  return [...known, ...extra]
    .map((category) => ({
      category,
      styles: filtered.filter((s) => s.category === category).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.styles.length > 0);
}

/** "custom_my_style", or "custom_my_style_2" when taken. */
export function newCustomId(name: string, existingIds: readonly string[]): string {
  const slug =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "style";
  const base = `custom_${slug}`;
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function blankStyle(): StyleProfile {
  return {
    id: "",
    name: "",
    category: CATEGORIES[0],
    version: "1.0",
    core_identity: "",
    medium: "",
    lighting: "",
    color_palette: "",
    camera: "",
    composition: "",
    texture: "",
    characters: "",
    mood: "",
    negative: "",
    motion_rules: "",
    style_lock: "",
    example_prompt: "",
    thumbnail: "",
    builtin: false,
  };
}

/** A copy of any style as a new custom style, ready to be edited. */
export function duplicateStyle(style: StyleProfile, existingIds: readonly string[]): StyleProfile {
  const name = `${style.name} (copy)`;
  return { ...style, id: newCustomId(name, existingIds), name, builtin: false };
}
