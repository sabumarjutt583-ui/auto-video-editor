/**
 * Which characters a font file can draw, read from its `cmap` table (TrueType and OpenType, formats 4 and 12; no dependency).
 * Returns a function: code point -> true when the font has a real glyph for it.
 */
export function glyphChecker(bytes: Uint8Array): (codePoint: number) => boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number): number => (o >= 0 && o + 2 <= view.byteLength ? view.getUint16(o) : 0);
  const u32 = (o: number): number => (o >= 0 && o + 4 <= view.byteLength ? view.getUint32(o) : 0);
  const tables = u16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...[0, 1, 2, 3].map((k) => bytes[at + k] ?? 0));
    if (tag === "cmap") cmap = u32(at + 8);
  }
  if (cmap < 0) return () => false;
  const count = u16(cmap + 2);
  // Prefer the full Unicode table (format 12), then the Basic Multilingual Plane table (format 4).
  let best = -1, bestRank = -1;
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8;
    const platform = u16(record), encoding = u16(record + 2), offset = cmap + u32(record + 4);
    const format = u16(offset);
    const rank = format === 12 && ((platform === 3 && encoding === 10) || platform === 0) ? 3 : format === 4 && ((platform === 3 && encoding === 1) || platform === 0) ? 2 : format === 12 ? 1 : 0;
    if (rank > bestRank) { best = offset; bestRank = rank; }
  }
  if (best < 0 || bestRank < 1) return () => false;
  const format = u16(best);
  if (format === 12) {
    const groups = u32(best + 12);
    return (cp) => {
      let lo = 0, hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = best + 16 + mid * 12;
        if (cp < u32(g)) hi = mid - 1;
        else if (cp > u32(g + 4)) lo = mid + 1;
        else return u32(g + 8) + (cp - u32(g)) !== 0;
      }
      return false;
    };
  }
  const segments = u16(best + 6) / 2;
  const ends = best + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
  return (cp) => {
    if (cp > 0xffff) return false;
    for (let i = 0; i < segments; i++) {
      if (cp > u16(ends + i * 2)) continue;
      const start = u16(starts + i * 2);
      if (cp < start) return false;
      const offset = u16(ranges + i * 2);
      if (offset === 0) return ((cp + u16(deltas + i * 2)) & 0xffff) !== 0;
      const glyph = u16(ranges + i * 2 + offset + (cp - start) * 2);
      return glyph !== 0 && ((glyph + u16(deltas + i * 2)) & 0xffff) !== 0;
    }
    return false;
  };
}

/** Characters that need no glyph of their own (spaces, direction marks, joiners). */
export function needsNoGlyph(cp: number): boolean {
  return cp <= 0x20 || (cp >= 0x7f && cp <= 0xa0) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x00ad || (cp >= 0xfe00 && cp <= 0xfe0f);
}

/** The families of a CSS font list, in order: `"Noto Sans KR", "Noto Sans", sans-serif` -> Noto Sans KR, Noto Sans. */
export function familiesOf(cssList: string): string[] {
  return [...cssList.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Characters of a text that none of the families can draw. `has(family, cp)` is null when a font is unknown (not counted). */
export function missingCharacters(text: string, families: readonly string[], has: (family: string, codePoint: number) => boolean | null): string[] {
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (needsNoGlyph(cp)) continue;
    const answers = families.map((f) => has(f, cp));
    if (answers.some((a) => a === true)) continue;
    if (answers.every((a) => a === null)) continue;
    missing.add(ch);
  }
  return [...missing];
}
