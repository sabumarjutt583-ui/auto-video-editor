import type { Theme } from "../render/theme.ts";

export const COLOR_ROLES = ["primary", "secondary", "accent", "text", "muted", "background"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Colours that replace the brand kit's for one graphic only (role -> #RRGGBB). */
export type ColorOverrides = Partial<Record<ColorRole, string>>;

/** Keeps only valid roles with valid #RRGGBB values. */
export function cleanOverrides(value: unknown): ColorOverrides {
  const out: ColorOverrides = {};
  if (typeof value !== "object" || value === null) return out;
  for (const role of COLOR_ROLES) {
    const v = (value as Record<string, unknown>)[role];
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[role] = v.toLowerCase();
  }
  return out;
}

/** The kit's theme with the graphic's own colours on top. */
export function themeWith(theme: Theme, overrides: ColorOverrides | undefined): Theme {
  const clean = cleanOverrides(overrides);
  return Object.keys(clean).length === 0 ? theme : { ...theme, colors: { ...theme.colors, ...clean } };
}
