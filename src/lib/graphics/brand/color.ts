/** `#RGB` or `#RRGGBB` (any case) as lower-case `#rrggbb`, or null when it is not a colour. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
  if (!m) return null;
  const hex = (m[1] as string).toLowerCase();
  return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
}

function channels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** `a` and `b` mixed: `amount` 0 = a, 1 = b. */
export function mixHex(a: string, b: string, amount: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const out = ca.map((v, i) => Math.round(v + ((cb[i] as number) - v) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance, 0..1. */
export function luminance(hex: string): number {
  const lin = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (lin[0] as number) + 0.7152 * (lin[1] as number) + 0.0722 * (lin[2] as number);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
