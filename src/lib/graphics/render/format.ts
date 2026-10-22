/**
 * Number text for counters and chart values. Written by hand instead of Intl so that every computer (and the export)
 * gives the same text: Western digits, "," between thousands, "." for decimals, K / M / B / T for compact numbers.
 */
export type NumberFormat = "plain" | "grouped" | "compact";

export interface NumberStyle {
  decimals: number;
  format: NumberFormat;
  prefix?: string;
  suffix?: string;
}

const UNITS: ReadonlyArray<readonly [number, string]> = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];

function group(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/** `toFixed` that never prints "-0". */
function fixed(value: number, decimals: number): string {
  const text = value.toFixed(Math.max(0, Math.min(6, decimals)));
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

function withGrouping(text: string): string {
  const negative = text.startsWith("-");
  const [whole = "", fraction] = (negative ? text.slice(1) : text).split(".");
  return `${negative ? "-" : ""}${group(whole)}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/** "-$3.5M", "1,200,000", "45%": sign, then prefix, number, suffix. */
export function formatNumber(value: number, style: NumberStyle): string {
  const finite = Number.isFinite(value) ? value : 0;
  let body: string;
  if (style.format === "compact") {
    const abs = Math.abs(finite);
    // The first unit the value reaches; 999,999 with no decimals would read "1000K", so it goes up to M.
    let picked = UNITS.find(([size]) => abs >= size);
    if (picked && Number((abs / picked[0]).toFixed(style.decimals)) >= 1000) picked = UNITS[UNITS.indexOf(picked) - 1] ?? picked;
    body = picked ? `${withGrouping(fixed(finite / picked[0], style.decimals))}${picked[1]}` : withGrouping(fixed(finite, style.decimals));
  } else if (style.format === "grouped") {
    body = withGrouping(fixed(finite, style.decimals));
  } else {
    body = fixed(finite, style.decimals);
  }
  const negative = body.startsWith("-");
  const digits = negative ? body.slice(1) : body;
  return `${negative ? "-" : ""}${style.prefix ?? ""}${digits}${style.suffix ?? ""}`;
}

/** A chart value: no decimals for whole numbers, one decimal for small fractions, compact above a million. */
export function formatChartValue(value: number, unit?: string): string {
  const prefixUnits = "$€£¥₩₹";
  const prefix = unit && prefixUnits.includes(unit) ? unit : undefined;
  const suffix = unit && !prefix ? unit : undefined;
  const abs = Math.abs(value);
  const style: NumberStyle =
    abs >= 1e6 ? { decimals: 1, format: "compact" } : { decimals: Number.isInteger(value) || abs >= 100 ? 0 : abs >= 10 ? 1 : 2, format: "grouped" };
  return formatNumber(value, { ...style, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) });
}
