import { DEFAULT_THEME, type Theme } from "../render/theme.ts";
import { mixHex } from "./color.ts";
import type { BrandKit } from "./model.ts";

/** Colours for charts: the kit's own colours first, then the standard ones. */
export function paletteOf(colors: BrandKit["colors"]): string[] {
  return [colors.primary, colors.accent, colors.success, colors.danger, ...DEFAULT_THEME.palette.slice(3, 11)];
}

/** The renderer's theme for a brand kit. */
export function themeOfKit(kit: BrandKit): Theme {
  const family = (name: string): string => (name === "Noto Sans" ? '"Noto Sans", sans-serif' : `"${name}", "Noto Sans", sans-serif`);
  return {
    colors: { ...kit.colors, muted: mixHex(kit.colors.text, kit.colors.background, 0.25) },
    palette: paletteOf(kit.colors),
    fonts: {
      latin: family(kit.fonts.latin),
      cyrillic: family(kit.fonts.cyrillic),
      korean: family(kit.fonts.korean),
      japanese: family(kit.fonts.japanese),
      chinese: family(kit.fonts.chinese),
      devanagari: family(kit.fonts.devanagari),
      arabic: family(kit.fonts.arabic),
    },
    radius: kit.radius,
    strokeWidth: kit.strokeWidth,
    shadow: kit.shadow,
    headingWeight: kit.headingWeight,
    headingCase: kit.headingCase,
    enter: kit.enter.preset === "none" ? undefined : { preset: kit.enter.preset, duration: kit.enter.duration, easing: kit.easing },
    exit: kit.exit.preset === "none" ? undefined : { preset: kit.exit.preset, duration: kit.exit.duration, easing: kit.easing },
  };
}

/** The fonts (family names) a kit uses, for loading. */
export function fontFamiliesOf(kit: BrandKit): string[] {
  return [...new Set(["Noto Sans", ...Object.values(kit.fonts)])];
}

/** A short description of the kit for the AI (colours, mood, density). */
export function kitSummary(kit: BrandKit): string {
  const c = kit.colors;
  return `Brand kit "${kit.name}": primary ${c.primary}, accent ${c.accent}, text ${c.text} on ${c.background}; corners ${kit.radius < 0.5 ? "square" : kit.radius > 1.3 ? "very round" : "rounded"}; titles ${kit.headingCase === "upper" ? "in capital letters" : "in normal case"}; entrance ${kit.enter.preset}; density ${kit.density}.`;
}
