import type { AppError } from "../types";

function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.message === "string" && typeof record.details === "string";
}

/** Turns anything thrown (a Rust AppError, an Error, a string) into an AppError. */
export function toAppError(error: unknown, fallbackMessage = "Something went wrong."): AppError {
  if (isAppError(error)) return error;
  return {
    message: fallbackMessage,
    details: error instanceof Error ? error.message : String(error),
  };
}

/** True when the user pressed Cancel on a background job. */
export function isCancelled(error: unknown): boolean {
  return isAppError(error) && error.code === "cancelled";
}
