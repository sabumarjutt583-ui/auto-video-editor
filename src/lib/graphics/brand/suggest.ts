import { BOLD_NEWS, CLEAN_DOCUMENTARY, SOFT_STORY } from "./builtin.ts";
import type { BrandKit } from "./model.ts";

/** Kits that match a look. They are variations of the built-in kits and use only the bundled fonts. */
const MONOCHROME: BrandKit = {
  ...CLEAN_DOCUMENTARY,
  id: "mono_noir",
  name: "Monochrome",
  colors: { primary: "#e5e5e5", secondary: "#171717", accent: "#a3a3a3", text: "#fafafa", background: "#0a0a0a", success: "#d4d4d4", danger: "#8a8a8a" },
  radius: 0.2,
  strokeWidth: 1.2,
  shadow: 0.6,
  headingCase: "upper",
  enter: { preset: "fade", duration: 0.7 },
  exit: { preset: "fade", duration: 0.6 },
  easing: "easeInOut",
  safeMargins: { x: 0.06, y: 0.07 },
};
const BRIGHT_POP: BrandKit = {
  ...SOFT_STORY,
  id: "bright_pop",
  name: "Bright Pop",
  colors: { primary: "#ff3d8b", secondary: "#241a6b", accent: "#ffe14d", text: "#ffffff", background: "#120d3c", success: "#3ddc97", danger: "#ff6b6b" },
  radius: 1.6,
  strokeWidth: 1.4,
  shadow: 0.5,
  headingWeight: 700,
  enter: { preset: "pop", duration: 0.35 },
  exit: { preset: "scale", duration: 0.25 },
  easing: "easeOutBack",
  density: "normal",
  safeMargins: { x: 0.05, y: 0.06 },
};
const NEON_TECH: BrandKit = {
  ...BOLD_NEWS,
  id: "neon_tech",
  name: "Neon Tech",
  colors: { primary: "#22d3ee", secondary: "#0b1220", accent: "#e879f9", text: "#f0f9ff", background: "#05060f", success: "#4ade80", danger: "#fb7185" },
  radius: 0.5,
  strokeWidth: 1.3,
  shadow: 0.5,
  headingCase: "upper",
  enter: { preset: "wipe", duration: 0.35 },
  exit: { preset: "wipe", duration: 0.25 },
  easing: "easeOutExpo",
  density: "normal",
};
const WARM_VINTAGE: BrandKit = {
  ...CLEAN_DOCUMENTARY,
  id: "warm_vintage",
  name: "Warm Vintage",
  colors: { primary: "#b45309", secondary: "#2b1d12", accent: "#fbbf24", text: "#fef3c7", background: "#1c1209", success: "#84a35a", danger: "#c2410c" },
  radius: 0.6,
  strokeWidth: 1,
  shadow: 0.5,
  enter: { preset: "fade", duration: 0.6 },
  exit: { preset: "fade", duration: 0.5 },
  easing: "easeInOut",
};
const ELEGANT: BrandKit = {
  ...CLEAN_DOCUMENTARY,
  id: "elegant_gold",
  name: "Elegant Gold",
  colors: { primary: "#d4af37", secondary: "#141414", accent: "#f5e6b3", text: "#ffffff", background: "#0b0b0b", success: "#9bbf8a", danger: "#d98080" },
  radius: 0.4,
  strokeWidth: 0.8,
  shadow: 0.3,
  headingWeight: 400,
  headingCase: "upper",
  enter: { preset: "fade", duration: 0.8 },
  exit: { preset: "fade", duration: 0.6 },
  easing: "easeInOut",
  density: "low",
  safeMargins: { x: 0.07, y: 0.08 },
};
const DARK_MYSTERY: BrandKit = {
  ...CLEAN_DOCUMENTARY,
  id: "dark_mystery",
  name: "Dark Mystery",
  colors: { primary: "#9f1239", secondary: "#1a1423", accent: "#c4b5fd", text: "#f5f3ff", background: "#0c0713", success: "#6ee7b7", danger: "#f43f5e" },
  radius: 0.5,
  shadow: 0.6,
  headingCase: "upper",
  enter: { preset: "fade", duration: 0.8 },
  exit: { preset: "fade", duration: 0.7 },
  easing: "easeInOut",
  density: "low",
};

const BY_STYLE: Record<string, { kit: BrandKit; reason: string }> = {};
function assign(ids: string[], kit: BrandKit, reason: string): void {
  for (const id of ids) BY_STYLE[id] = { kit, reason };
}
assign(["noir", "black_and_white_photography", "charcoal_sketch", "pencil_sketch", "ink_drawing"], MONOCHROME, "a black-and-white look needs grey tones and quiet capital-letter titles");
assign(["anime", "manga", "2d_animation", "2d_cartoon", "doodle", "comic_book", "flat_illustration", "vector_illustration", "paper_cutout", "claymation", "stop_motion", "animated_film_3d"], BRIGHT_POP, "a playful look suits bright colours and bouncy entrances");
assign(["cyberpunk", "sci_fi_concept_art", "hyper_realistic_3d_render", "isometric_3d", "low_poly", "scientific_visualization"], NEON_TECH, "a technical or futuristic look suits cool neon colours and sharp wipes");
assign(["vintage_film", "retro", "historical_cinematic", "steampunk", "oil_painting", "japanese_ukiyo_e", "acrylic_painting"], WARM_VINTAGE, "an old or painted look suits warm brown and gold tones");
assign(["luxury_commercial", "fashion_editorial", "product_photography", "architectural_visualization", "minimalist"], ELEGANT, "a premium look suits thin capital letters, gold and slow fades");
assign(["horror_dark_mystery", "dark_fantasy", "surreal", "emotional_drama"], DARK_MYSTERY, "a dark or moody look suits deep reds, violet and slow fades");
assign(["soft_pastel", "watercolor", "dreamlike", "childrens_storybook", "storybook_illustration", "graphic_novel", "fantasy_concept_art"], SOFT_STORY, "a gentle painted look suits warm colours, round corners and slow fades");
assign(["documentary_style", "cinematic_realism", "photorealistic", "educational_3d", "medical_3d"], CLEAN_DOCUMENTARY, "a realistic or educational look suits calm, neutral graphics");

export const SUGGESTED_KITS: readonly BrandKit[] = [MONOCHROME, BRIGHT_POP, NEON_TECH, WARM_VINTAGE, ELEGANT, DARK_MYSTERY];

/** The kit that goes with a visual style (the style id, e.g. `noir`). Unknown and custom styles get Clean Documentary. */
export function suggestKit(styleId: string): { kit: BrandKit; reason: string } {
  return BY_STYLE[styleId] ?? { kit: CLEAN_DOCUMENTARY, reason: "no special match, so the neutral kit is the safe choice" };
}

/** Every style id with a special suggestion (for tests). */
export const SUGGESTED_STYLE_IDS: readonly string[] = Object.keys(BY_STYLE);
