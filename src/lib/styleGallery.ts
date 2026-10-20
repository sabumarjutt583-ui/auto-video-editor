import type { StyleProfile } from "../types/style.ts";
import { CATEGORIES, groupStyles } from "./styleModel.ts";

export const TAB_ALL = "all";
export const TAB_FAVORITES = "favorites";
export const TAB_RECENT = "recent";
export const TAB_MINE = "mine";
export const RECENT_LIMIT = 6;

export interface GalleryTab {
  id: string;
  label: string;
}

/** All, Favorites, Recently used, then every category that has styles, then My Styles. */
export function galleryTabs(styles: readonly StyleProfile[]): GalleryTab[] {
  const present = new Set(styles.filter((s) => s.builtin).map((s) => s.category));
  const categories = [...CATEGORIES.filter((c) => present.has(c)), ...[...present].filter((c) => !(CATEGORIES as readonly string[]).includes(c)).sort()];
  return [
    { id: TAB_ALL, label: "All" },
    { id: TAB_FAVORITES, label: "Favorites" },
    { id: TAB_RECENT, label: "Recently used" },
    ...categories.map((category) => ({ id: category, label: category })),
    { id: TAB_MINE, label: "My Styles" },
  ];
}

/** Does the search text appear in the name, the category or the mood? Every word must match. */
export function matchesQuery(style: StyleProfile, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const haystack = `${style.name} ${style.category} ${style.mood}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

interface View {
  styles: readonly StyleProfile[];
  tab: string;
  query: string;
  favorites: readonly string[];
  recent: readonly string[];
}

/** The styles a tab shows, in picker order (recently used: newest first), narrowed by the search. */
export function visibleStyles({ styles, tab, query, favorites, recent }: View): StyleProfile[] {
  const ordered = groupStyles(styles).flatMap((group) => group.styles);
  let shown: StyleProfile[];
  if (tab === TAB_FAVORITES) shown = ordered.filter((s) => favorites.includes(s.id));
  else if (tab === TAB_RECENT) shown = recent.map((id) => ordered.find((s) => s.id === id)).filter((s): s is StyleProfile => s !== undefined);
  else if (tab === TAB_MINE) shown = ordered.filter((s) => !s.builtin);
  else if (tab === TAB_ALL) shown = ordered;
  else shown = ordered.filter((s) => s.category === tab);
  return shown.filter((s) => matchesQuery(s, query));
}

/** The used style goes to the front; each style appears once; at most 6 are kept. */
export function addRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_LIMIT);
}

export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
}

/** The first sentence of a text, for tooltips. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  return trimmed.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? trimmed;
}

/** Where the keyboard focus goes from card `index` in a grid with `columns` columns. */
export function moveFocus(index: number, total: number, columns: number, key: string): number {
  if (total <= 0) return -1;
  const cols = Math.max(1, columns);
  const clamp = (n: number) => Math.min(total - 1, Math.max(0, n));
  switch (key) {
    case "ArrowRight":
      return clamp(index + 1);
    case "ArrowLeft":
      return clamp(index - 1);
    case "ArrowDown":
      return index + cols <= total - 1 ? index + cols : index;
    case "ArrowUp":
      return index - cols >= 0 ? index - cols : index;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return index;
  }
}
