/** One day, in seconds. */
export const DAY_SECONDS = 24 * 60 * 60;
/** The silent check at startup waits this long, so it never slows the start. */
export const STARTUP_DELAY_MS = 5000;

/** The automatic check runs when it is switched on and the last check was more than a day ago (or never). */
export function shouldAutoCheck(enabled: boolean, lastCheckedSeconds: number, nowSeconds: number): boolean {
  if (!enabled) return false;
  if (!Number.isFinite(lastCheckedSeconds) || lastCheckedSeconds <= 0) return true;
  // A time in the future means the clock was changed: check again.
  if (lastCheckedSeconds > nowSeconds) return true;
  return nowSeconds - lastCheckedSeconds >= DAY_SECONDS;
}

/** The release notes made short for the banner: no markdown signs, at most 3 lines and `limit` letters. */
export function shortNotes(notes: string, limit = 220): string {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#{1,6}\s*|[-*+]\s+|>\s*)/, "").replace(/[`*_]/g, "").trim())
    .filter((line) => line !== "");
  const text = lines.slice(0, 3).join(" · ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** "Last checked" text for the Settings page. */
export function lastCheckedText(lastCheckedSeconds: number, locale?: string): string {
  if (!Number.isFinite(lastCheckedSeconds) || lastCheckedSeconds <= 0) return "Never";
  return new Date(lastCheckedSeconds * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
