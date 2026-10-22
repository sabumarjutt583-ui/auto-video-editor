import type { IconShape } from "../render/context.ts";
import names from "../assets/icons/names.json" with { type: "json" };

/**
 * The bundled icon sets: Lucide (ISC, the default) and Tabler Icons (MIT). Only icons in the index can be used.
 * The names are always loaded (validation, ~30 kB packed); the path data of a set is loaded the first time one of its icons is needed.
 * Tabler solid icons are named `<name>-filled`.
 */
export type IconSet = "lucide" | "tabler";
export const ICON_SETS: readonly IconSet[] = ["lucide", "tabler"];

interface RawIcon {
  /** Stroke paths (all paths when `a` is 1). */
  p: string[];
  /** Paths drawn filled inside an outline icon (dots). */
  f?: string[];
  /** 1 for a solid icon: every path is filled. */
  a?: 1;
}
type RawSet = Record<string, RawIcon>;

const nameSets: Record<IconSet, ReadonlySet<string>> = { lucide: new Set(names.lucide), tabler: new Set(names.tabler) };
const loaders: Record<IconSet, () => Promise<{ default: RawSet }>> = {
  lucide: () => import("../assets/icons/lucide.json", { with: { type: "json" } }) as Promise<{ default: RawSet }>,
  tabler: () => import("../assets/icons/tabler.json", { with: { type: "json" } }) as Promise<{ default: RawSet }>,
};
const loaded: Partial<Record<IconSet, RawSet>> = {};
const pending: Partial<Record<IconSet, Promise<void>>> = {};

export function isIconSet(value: string): value is IconSet {
  return value === "lucide" || value === "tabler";
}

/** True when the icon is in the index (this is the check every GraphicSpec goes through). */
export function hasIcon(set: string, name: string): boolean {
  return isIconSet(set) && nameSets[set].has(name);
}

export function iconNames(set: IconSet): readonly string[] {
  return names[set];
}

export function loadIconSet(set: IconSet): Promise<void> {
  const existing = pending[set];
  if (existing) return existing;
  const task = loaders[set]().then((module) => {
    loaded[set] = module.default;
  });
  pending[set] = task;
  return task;
}

function shapeOf(raw: RawIcon): IconShape {
  return { paths: raw.p, ...(raw.f ? { fillPaths: raw.f } : {}), viewBox: 24, filled: raw.a === 1, strokeWidth: 2 };
}

/** The icon, when its set has been loaded (see `ensureIcons`). Undefined for an unknown name. */
export function iconShape(set: string, name: string): IconShape | undefined {
  if (!isIconSet(set)) return undefined;
  const raw = loaded[set]?.[name];
  return raw ? shapeOf(raw) : undefined;
}

export interface IconRef {
  set: string;
  name: string;
}

/** Every icon a spec uses (icon layers, lower thirds, list items). */
export function iconRefsOf(spec: unknown): IconRef[] {
  const found = new Map<string, IconRef>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "icon" && child && typeof child === "object" && "set" in child && "name" in child) {
          const ref = child as { set: unknown; name: unknown };
          if (typeof ref.set === "string" && typeof ref.name === "string") found.set(`${ref.set}:${ref.name}`, { set: ref.set, name: ref.name });
        } else {
          walk(child);
        }
      }
    }
  };
  walk(spec);
  return [...found.values()];
}

/** Loads the sets a list of icons needs. After this `iconShape` answers for them. */
export async function ensureIcons(refs: readonly IconRef[]): Promise<void> {
  const sets = new Set<IconSet>();
  for (const ref of refs) if (isIconSet(ref.set)) sets.add(ref.set);
  await Promise.all([...sets].map(loadIconSet));
}

/** The icons of a spec as plain data (`"set:name"` -> shape), for a Web Worker that cannot load the sets itself. */
export async function iconsOfSpec(spec: unknown): Promise<Record<string, IconShape>> {
  const refs = iconRefsOf(spec);
  await ensureIcons(refs);
  const out: Record<string, IconShape> = {};
  for (const ref of refs) {
    const shape = iconShape(ref.set, ref.name);
    if (shape) out[`${ref.set}:${ref.name}`] = shape;
  }
  return out;
}

/** An icon lookup for a render context made from `iconsOfSpec`. */
export function iconLookup(icons: Readonly<Record<string, IconShape>>): (set: string, name: string) => IconShape | undefined {
  return (set, name) => icons[`${set}:${name}`];
}

// ---- Search (used by the graphics director to offer the AI a short list of icons) ----

interface TagIndex {
  lucide: Record<string, string>;
  tabler: Record<string, string>;
}
let tagIndex: Promise<TagIndex> | null = null;

export interface IconHit {
  set: IconSet;
  name: string;
  score: number;
}

/**
 * Finds icons by keywords: whole name words and tags score higher than parts of words. Ties keep a fixed order
 * (Lucide first, then by name) so the result is the same every time. Tabler solid duplicates are only listed when asked for ("filled").
 */
export async function searchIcons(query: string, limit = 30): Promise<IconHit[]> {
  tagIndex ??= import("../assets/icons/tags.json", { with: { type: "json" } }).then((m) => m.default as TagIndex);
  const index = await tagIndex;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return [];
  const wantsFilled = words.includes("filled") || words.includes("solid");
  const hits: IconHit[] = [];
  for (const set of ICON_SETS) {
    for (const name of names[set]) {
      if (name.endsWith("-filled") && !wantsFilled) continue;
      const nameWords = name.split("-");
      const tags = (index[set][name] ?? "").split(",");
      let score = wantsFilled && name.endsWith("-filled") ? 8 : 0;
      for (const w of words) {
        if (w === "filled" || w === "solid") continue;
        if (nameWords.includes(w)) score += 10;
        else if (name.includes(w)) score += 4;
        if (tags.includes(w)) score += 6;
        else if (tags.some((t) => t.includes(w))) score += 2;
      }
      if (score > 0) hits.push({ set, name, score: set === "lucide" ? score + 0.5 : score });
    }
  }
  hits.sort((a, b) => b.score - a.score || (a.set === b.set ? a.name.localeCompare(b.name) : a.set === "lucide" ? -1 : 1));
  return hits.slice(0, limit);
}
