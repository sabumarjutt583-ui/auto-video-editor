import { BANNED_NAMES } from "../../styleChecks.ts";

/** Brand, studio, franchise and artist names the AI must not add to a graphic (lower case). */
export const BRAND_WORDS: readonly string[] = [
  ...BANNED_NAMES, "nintendo", "pokemon", "pokémon", "mickey mouse", "star wars", "harry potter", "lego", "coca-cola", "coca cola", "pepsi", "mcdonald", "nike", "adidas",
  "netflix", "picasso", "van gogh", "banksy", "monet", "warhol", "dali", "dalí", "disneyland",
];

/**
 * A brand or artist name in a graphic's text that the narration does not say. A name the narrator says (a story about a painter)
 * is fine: the graphic shows what the narration says. Returns the name, or null.
 */
export function addedBrandName(graphicTexts: readonly string[], narration: string): string | null {
  const said = narration.toLowerCase();
  for (const text of graphicTexts) {
    const lower = text.toLowerCase();
    for (const word of BRAND_WORDS) {
      if (lower.includes(word) && !said.includes(word)) return word;
    }
  }
  return null;
}
