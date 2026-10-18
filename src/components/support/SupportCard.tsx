import { LifeBuoy } from "lucide-react";
import { useState } from "react";

import { pickFolder } from "../../lib/dialog";
import { exportLogs } from "../../lib/appUpdate/api";
import { toAppError } from "../../lib/errors";
import type { AppError, AppSettings } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Checkbox } from "../ui";

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Log files for support. Keys are never written to them. */
export function SupportCard({ settings, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const run = async () => {
    setError(null);
    setSaved(null);
    try {
      const folder = await pickFolder("Where should the log file be saved?", settings.exportFolder || undefined);
      if (!folder) return;
      setBusy(true);
      setSaved(await exportLogs(folder));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Help and logs" description="If something goes wrong, send the log file to the person who supports you. It has no API keys." icon={LifeBuoy}>
      <Checkbox label="Debug logging (longer texts in the log; turn on only when support asks)" checked={settings.debugLogging} onChange={(e) => onChange({ debugLogging: e.target.checked })} />
      <div className="flex items-center gap-3">
        <Button loading={busy} onClick={() => void run()}>
          Export logs
        </Button>
        {saved && <span className="text-sm break-all" role="status" data-testid="logs-saved">Saved: {saved}</span>}
      </div>
      {error && <ErrorNotice error={error} />}
    </Card>
  );
}
