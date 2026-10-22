import { HardDrive } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { toAppError } from "../../../lib/errors";
import { cacheInfo, clearCache, type CacheInfo } from "../../../lib/graphics/cache/api";
import type { AppError } from "../../../types";
import { ErrorNotice } from "../../ErrorNotice";
import { Button, Card } from "../../ui";

const size = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`);

/** Settings: the graphics cache (drawn clips kept for next time, at most 5 GB) with a Clear cache button. */
export function GraphicCacheCard() {
  const [info, setInfo] = useState<CacheInfo | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { cacheInfo().then(setInfo).catch((e: unknown) => setError(toAppError(e, "The graphics cache could not be read."))); }, []);
  useEffect(load, [load]);
  const clear = async () => {
    setBusy(true);
    setError(null);
    try { await clearCache(); } catch (e) { setError(toAppError(e, "The graphics cache could not be emptied.")); }
    setBusy(false);
    load();
  };
  return (
    <Card title="Graphics cache" description="Motion graphics you drew once are kept here, so drawing the same one again takes no time. The oldest are removed when it reaches 5 GB. Graphics already in your projects are not touched." icon={HardDrive}>
      <p className="text-sm" data-testid="graphic-cache-status">{info === null ? "Checking…" : `${info.files} graphic${info.files === 1 ? "" : "s"} · ${size(info.bytes)} of ${size(info.limitBytes)}`}</p>
      <div><Button disabled={busy || info === null || info.files === 0} onClick={() => void clear()}>Clear cache</Button></div>
      {error && <ErrorNotice error={error} />}
    </Card>
  );
}
