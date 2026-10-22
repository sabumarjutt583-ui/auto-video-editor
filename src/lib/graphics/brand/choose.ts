import { BUILTIN_KITS, DEFAULT_KIT_ID } from "./builtin.ts";
import type { BrandKit } from "./model.ts";
import { repairBrandKit } from "./repair.ts";
import { SUGGESTED_KITS, suggestKit } from "./suggest.ts";

export interface KitChoice {
  /** Kits the person made or changed (repaired when read). */
  custom: readonly unknown[];
  /** The kit chosen for the whole app (settings). */
  activeId: string;
  /** The kit chosen for this project, "" = use the app's. */
  projectId: string;
  /** Style of the project, used by "match the style". */
  styleId: string;
}

/** Every kit the person can pick: built-in, suggested, then their own (invalid ones are repaired, duplicates by id dropped). */
export function allKits(custom: readonly unknown[]): BrandKit[] {
  const seen = new Set<string>();
  const out: BrandKit[] = [];
  for (const kit of [...BUILTIN_KITS, ...SUGGESTED_KITS, ...custom.map((c) => repairBrandKit(c).kit)]) {
    if (seen.has(kit.id)) continue;
    seen.add(kit.id);
    out.push(kit);
  }
  return out;
}

/** A kit by id, or undefined. `match-style` gives the suggestion for the project's style. */
export function findKit(id: string, custom: readonly unknown[], styleId = ""): BrandKit | undefined {
  if (id === "match-style") return suggestKit(styleId).kit;
  return allKits(custom).find((kit) => kit.id === id);
}

/** The kit a project's graphics use: the project's own choice, else the app's, else Clean Documentary. */
export function resolveKit(choice: KitChoice): BrandKit {
  for (const id of [choice.projectId, choice.activeId, DEFAULT_KIT_ID]) {
    if (id === "") continue;
    const kit = findKit(id, choice.custom, choice.styleId);
    if (kit) return kit;
  }
  return BUILTIN_KITS[0] as BrandKit;
}
