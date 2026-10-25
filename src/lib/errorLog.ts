import type { AppError } from "../types/index.ts";

const REMEMBER = 50;

/** Remembers the last errors that were sent to the log, so the same error shown again (or drawn twice) is written once. */
export function createErrorDeduper(): (key: string) => boolean {
  const seen: string[] = [];
  return (key) => {
    if (seen.includes(key)) return false;
    seen.push(key);
    if (seen.length > REMEMBER) seen.shift();
    return true;
  };
}

/** The text that goes into the log for an error the person saw. */
export function errorLogText(error: Pick<AppError, "message" | "details">): string {
  const details = error.details.trim();
  return details ? `${error.message} | ${details}` : error.message;
}
