import { useMemo } from "react";

import { allKits, DEFAULT_KIT_ID, isBuiltinKit, repairBrandKit, resolveKit, slugify, SUGGESTED_KITS, suggestKit, themeOfKit, type BrandKit } from "../../../lib/graphics/brand";
import type { Theme } from "../../../lib/graphics/render/theme";
import { readEditor } from "../../../lib/editor/model";
import { applyEdit } from "../../../store/historyStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type { Project } from "../../../types";

export const MATCH_STYLE = "match-style";

export interface BrandKitView {
  /** The kit this project's graphics use now. */
  kit: BrandKit;
  theme: Theme;
  /** What the project chose: a kit id, "match-style" or "" (the app's kit). */
  projectChoice: string;
  /** The kit of the whole app (Settings). */
  appKitId: string;
  /** Every kit the person can pick. */
  kits: BrandKit[];
  /** The kit that goes with the project's visual style. */
  suggested: { kit: BrandKit; reason: string };
  isCustom: (id: string) => boolean;
  chooseForProject: (id: string) => void;
  chooseForApp: (id: string) => void;
  /** Saves a kit of the person (a new one when the id is new). Returns the saved kit and what was repaired. */
  save: (kit: BrandKit) => { kit: BrandKit; notes: string[] };
  remove: (id: string) => void;
}

/** A free id for a new kit: the name as an id, with a number when it is taken. */
export function uniqueKitId(name: string, taken: readonly string[]): string {
  const base = slugify(name) || "kit";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const id = `${base.slice(0, 36)}_${n}`;
    if (!taken.includes(id)) return id;
  }
  return `${base.slice(0, 30)}_${Date.now().toString(36)}`;
}

/** The brand kit of a project: its own choice, else the app's. Kits of the person live in the settings. */
export function useBrandKit(project: Project): BrandKitView {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const custom = settings?.brandKits ?? [];
  const appKitId = settings?.brandKitId ?? DEFAULT_KIT_ID;
  const projectChoice = readEditor(project).brandKitId;
  const styleId = project.styleId ?? "";

  const kits = useMemo(() => allKits(custom), [custom]);
  const kit = useMemo(() => resolveKit({ custom, activeId: appKitId, projectId: projectChoice, styleId }), [custom, appKitId, projectChoice, styleId]);
  const theme = useMemo(() => themeOfKit(kit), [kit]);
  const customIds = useMemo(() => custom.map((c) => repairBrandKit(c).kit.id).filter((id) => !isBuiltinKit(id) && !SUGGESTED_KITS.some((k) => k.id === id)), [custom]);

  return {
    kit,
    theme,
    projectChoice,
    appKitId,
    kits,
    suggested: suggestKit(styleId),
    isCustom: (id) => customIds.includes(id),
    chooseForProject: (id) => applyEdit({ editor: { ...readEditor(project), brandKitId: id } }),
    chooseForApp: (id) => update({ brandKitId: id }),
    save: (draft) => {
      const { kit: clean, notes } = repairBrandKit(draft);
      const mine = custom.map((c) => repairBrandKit(c).kit);
      const taken = [...kits.map((k) => k.id)];
      const own = mine.some((k) => k.id === clean.id);
      const saved = own ? clean : { ...clean, id: uniqueKitId(clean.name, taken) };
      update({ brandKits: own ? mine.map((k) => (k.id === saved.id ? saved : k)) : [...mine, saved] });
      return { kit: saved, notes };
    },
    remove: (id) => {
      update({ brandKits: custom.map((c) => repairBrandKit(c).kit).filter((k) => k.id !== id), ...(appKitId === id ? { brandKitId: DEFAULT_KIT_ID } : {}) });
      if (projectChoice === id) applyEdit({ editor: { ...readEditor(project), brandKitId: "" } });
    },
  };
}
