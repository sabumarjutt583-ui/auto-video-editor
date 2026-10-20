import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { lastCheckedText } from "../../lib/appUpdate/schedule";
import { useAppUpdateStore } from "../../store/appUpdateStore";
import type { AppSettings } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Checkbox, Field, TextInput } from "../ui";

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Updates of the app itself. */
export function AppUpdateCard({ settings, onChange }: Props) {
  const { checking, available, message, error, check } = useAppUpdateStore();
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion, () => setVersion("unknown"));
  }, []);
  return (
    <Card title="Updates" description="New versions are signed by the publisher and checked before they are installed. Your projects are never touched." icon={RefreshCw}>
      <p className="text-sm">
        Current version: <strong data-testid="current-version">{version || "…"}</strong>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={RefreshCw} loading={checking} onClick={() => void check(false)}>
          Check for updates
        </Button>
        {available && <span className="text-sm" role="status">Version {available.version} is available. Use the button at the top of the app.</span>}
        {message && <span className="text-sm text-muted" role="status" data-testid="app-update-message">{message}</span>}
      </div>
      <p className="text-sm text-muted" data-testid="last-checked">
        Last checked: {lastCheckedText(settings.lastAppUpdateCheck)}
      </p>
      <Checkbox label="Check for updates automatically" checked={settings.autoCheckAppUpdates} onChange={(e) => onChange({ autoCheckAppUpdates: e.target.checked })} />
      <Field label="Update address (optional)" htmlFor="app-update-url" hint="Leave empty to use the address that came with the app. It must start with https://.">
        <TextInput id="app-update-url" value={settings.appUpdateUrl} spellCheck={false} placeholder="https://example.com/latest.json" onChange={(e) => onChange({ appUpdateUrl: e.target.value })} />
      </Field>
      {error && <ErrorNotice error={error} />}
    </Card>
  );
}
