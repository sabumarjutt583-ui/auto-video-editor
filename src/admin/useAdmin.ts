import { useCallback, useEffect, useState } from "react";

import { toAppError } from "../lib/errors";
import type { AppError } from "../types";
import { adminOverview, type AdminOverview } from "./api";

/** The admin's working library and settings, with a way to reload them after a change. */
export function useAdmin() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const reload = useCallback(async () => {
    try {
      setOverview(await adminOverview());
    } catch (e) {
      setError(toAppError(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  /** Runs an action, then reloads. Errors are shown. */
  const act = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      setError(null);
      try {
        const result = await action();
        await reload();
        return result;
      } catch (e) {
        setError(toAppError(e));
        return undefined;
      }
    },
    [reload],
  );
  return { overview, error, setError, reload, act };
}
