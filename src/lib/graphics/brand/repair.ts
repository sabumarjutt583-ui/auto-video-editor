import { CLEAN_DOCUMENTARY } from "./builtin.ts";
import { contrast, normalizeHex } from "./color.ts";
import { COLOR_KEYS, DENSITIES, EASINGS, ENTER_PRESETS, EXIT_PRESETS, FONT_CHOICES, KIT_LIMITS, SCRIPTS, type BrandKit } from "./model.ts";

export interface RepairedKit {
  kit: BrandKit;
  /** What was wrong and what was done, in plain English (empty when the kit was fine). */
  notes: string[];
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): { value: T; ok: boolean } {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? { value: value as T, ok: true } : { value: fallback, ok: false };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): { value: number; ok: boolean } {
  if (typeof value !== "number" || !Number.isFinite(value)) return { value: fallback, ok: false };
  const clamped = Math.min(max, Math.max(min, value));
  return { value: Math.round(clamped * 1000) / 1000, ok: clamped === value };
}

/** A kit id: lower-case letters, digits, `_` and `-`, at most 40 characters. */
export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return slug;
}

/**
 * Turns anything (a saved file, a pasted value, an AI answer) into a valid kit. Values that are missing or wrong are replaced
 * with those of `base` (Clean Documentary unless given), numbers are moved into their range, and a text colour that cannot be
 * read on the background is changed to white or black. Never throws.
 */
export function repairBrandKit(input: unknown, base: BrandKit = CLEAN_DOCUMENTARY): RepairedKit {
  const raw = record(input);
  const notes: string[] = [];
  const bad = (what: string, fix: string): void => void notes.push(`${what} ${fix}`);

  const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim().slice(0, KIT_LIMITS.nameMax) : base.name;
  if (name !== raw.name) bad("The kit name", `was missing or too long and became "${name}".`);
  let id = typeof raw.id === "string" && /^[a-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : slugify(name);
  if (id === "") id = "kit";
  if (id !== raw.id) bad("The kit id", `was not valid and became "${id}".`);

  const rawColors = record(raw.colors);
  const colors = { ...base.colors };
  for (const key of COLOR_KEYS) {
    const hex = normalizeHex(rawColors[key]);
    if (hex) colors[key] = hex;
    else bad(`The ${key} colour`, `was not a colour like #RRGGBB and was set to ${base.colors[key]}.`);
  }
  if (contrast(colors.text, colors.background) < 4.5) {
    const better = contrast("#ffffff", colors.background) >= contrast("#000000", colors.background) ? "#ffffff" : "#000000";
    bad("The text colour", `could not be read on the background and became ${better}.`);
    colors.text = better;
  }

  const rawFonts = record(raw.fonts);
  const fonts = { ...base.fonts };
  for (const script of SCRIPTS) {
    const choice = oneOf(rawFonts[script], FONT_CHOICES[script], base.fonts[script] as string);
    fonts[script] = choice.value;
    if (!choice.ok) bad(`The ${script} font`, `is not one of the bundled fonts and became ${choice.value}.`);
  }

  const radius = clampNumber(raw.radius, KIT_LIMITS.radius.min, KIT_LIMITS.radius.max, base.radius);
  const strokeWidth = clampNumber(raw.strokeWidth, KIT_LIMITS.strokeWidth.min, KIT_LIMITS.strokeWidth.max, base.strokeWidth);
  const shadow = clampNumber(raw.shadow, KIT_LIMITS.shadow.min, KIT_LIMITS.shadow.max, base.shadow);
  if (!radius.ok) bad("The corner radius", `was changed to ${radius.value}.`);
  if (!strokeWidth.ok) bad("The line thickness", `was changed to ${strokeWidth.value}.`);
  if (!shadow.ok) bad("The shadow strength", `was changed to ${shadow.value}.`);

  const weight = raw.headingWeight === 400 || raw.headingWeight === 700 ? raw.headingWeight : base.headingWeight;
  if (weight !== raw.headingWeight) bad("The title weight", `must be 400 or 700 and became ${weight}.`);
  const headingCase = oneOf(raw.headingCase, ["normal", "upper"] as const, base.headingCase);
  if (!headingCase.ok) bad("The title case", `became "${headingCase.value}".`);

  const rawEnter = record(raw.enter);
  const rawExit = record(raw.exit);
  const enterPreset = oneOf(rawEnter.preset, ENTER_PRESETS, base.enter.preset);
  const exitPreset = oneOf(rawExit.preset, EXIT_PRESETS, base.exit.preset);
  const enterSeconds = clampNumber(rawEnter.duration, KIT_LIMITS.duration.min, KIT_LIMITS.duration.max, base.enter.duration);
  const exitSeconds = clampNumber(rawExit.duration, KIT_LIMITS.duration.min, KIT_LIMITS.duration.max, base.exit.duration);
  if (!enterPreset.ok) bad("The entrance", `became "${enterPreset.value}".`);
  if (!exitPreset.ok) bad("The exit", `became "${exitPreset.value}".`);
  if (!enterSeconds.ok || !exitSeconds.ok) bad("An entrance or exit time", "was moved into 0 to 2 seconds.");
  const easing = oneOf(raw.easing, EASINGS, base.easing);
  if (!easing.ok) bad("The easing", `became "${easing.value}".`);

  const logo = typeof raw.logo === "string" && raw.logo.length <= KIT_LIMITS.logoMax && !/[\u0000-\u001f]/.test(raw.logo) ? raw.logo : "";
  if (raw.logo !== undefined && logo !== raw.logo) bad("The logo path", "was not valid and was removed.");
  const density = oneOf(raw.density, DENSITIES, base.density);
  if (!density.ok) bad("The graphic density", `became "${density.value}".`);

  const rawMargins = record(raw.safeMargins);
  const mx = clampNumber(rawMargins.x, KIT_LIMITS.safeMargin.min, KIT_LIMITS.safeMargin.max, base.safeMargins.x);
  const my = clampNumber(rawMargins.y, KIT_LIMITS.safeMargin.min, KIT_LIMITS.safeMargin.max, base.safeMargins.y);
  if (!mx.ok || !my.ok) bad("A safe margin", "was moved into 0 to 20 %.");

  const kit: BrandKit = {
    id, name, fonts, colors,
    radius: radius.value, strokeWidth: strokeWidth.value, shadow: shadow.value,
    headingWeight: weight, headingCase: headingCase.value,
    enter: { preset: enterPreset.value, duration: enterSeconds.value },
    exit: { preset: exitPreset.value, duration: exitSeconds.value },
    easing: easing.value, logo, density: density.value, safeMargins: { x: mx.value, y: my.value },
  };
  return { kit, notes };
}
