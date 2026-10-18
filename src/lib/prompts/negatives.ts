/** Turns a comma-separated negative list into the form each tool wants. */

export function splitNegatives(negative: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of negative.split(/[,;\n]/)) {
    const item = raw.trim();
    const key = item.toLowerCase();
    if (item !== "" && !seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

interface Rule {
  test: RegExp;
  phrase: string;
}

/** Known unwanted things and the wanted thing that replaces them. */
const RULES: readonly Rule[] = [
  { test: /\b(text|letters?|words?|watermark|logos?|signature|captions?|subtitles?)\b/i, phrase: "a clean image with no text, letters or logos" },
  { test: /\b(extra|missing|fused|deformed|malformed|bad)\b.*\b(fingers?|hands?|limbs?|arms?|legs?)\b|\b(fingers?|hands?)\b.*\bdeformed\b/i, phrase: "anatomically correct hands and limbs" },
  { test: /\b(distorted|deformed|ugly|asymmetrical|disfigured)\b.*\b(face|eyes?)\b|\b(face|eyes?)\b.*\b(distorted|deformed)\b/i, phrase: "a natural, well-formed face with symmetrical eyes" },
  { test: /\b(blur(ry)?|out of focus|soft focus|low[- ]?res(olution)?|pixelated|jpeg artifacts?|grainy)\b/i, phrase: "sharp focus and high resolution" },
  { test: /\b(over[- ]?saturated|neon|garish)\b/i, phrase: "natural, balanced colors" },
  { test: /\b(over[- ]?(exposed|processed)|hdr)\b/i, phrase: "natural exposure" },
  { test: /\b(cartoon|anime|illustration|painting|drawing|sketch)\b/i, phrase: "photographic realism" },
  { test: /\b(3d render|cgi|plastic|airbrushed)\b/i, phrase: "natural, real-world materials and skin" },
  { test: /\b(duplicate|cloned|extra people|crowd)\b/i, phrase: "only the people described, each shown once" },
  { test: /\b(cropped|cut off|out of frame)\b/i, phrase: "a complete, well-framed subject" },
  { test: /\b(border|frame|collage|split screen)\b/i, phrase: "one single full-frame image" },
];

/** "no text, blurry" becomes "a clean image with no text, letters or logos, sharp focus and high resolution". */
export function positiveNegatives(items: readonly string[]): string {
  const phrases: string[] = [];
  const leftovers: string[] = [];
  for (const item of items) {
    const rule = RULES.find((r) => r.test.test(item));
    if (rule) {
      if (!phrases.includes(rule.phrase)) phrases.push(rule.phrase);
    } else {
      leftovers.push(item);
    }
  }
  if (leftovers.length > 0) phrases.push(`free of ${leftovers.join(", ")}`);
  return phrases.length === 0 ? "" : `${phrases.join(", ")}.`;
}

/** A short line for video tools: the first few items only. */
export function shortNegativeLine(items: readonly string[], max = 6): string {
  return items.length === 0 ? "" : `Avoid: ${items.slice(0, max).join(", ")}.`;
}
