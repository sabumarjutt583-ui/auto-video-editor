import { RefreshCw } from "lucide-react";

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
  return (
    <Card title="App updates" description="New versions are signed by the publisher and checked before they are installed." icon={RefreshCw}>
      <Checkbox label="Look for a new version when the app starts" checked={settings.autoCheckAppUpdates} onChange={(e) => onChange({ autoCheckAppUpdates: e.target.checked })} />
      <Field label="Update address (optional)" htmlFor="app-update-url" hint="Leave empty to use the address that came with the app. It must start with https://.">
        <TextInput id="app-update-url" value={settings.appUpdateUrl} spellCheck={false} placeholder="https://example.com/latest.json" onChange={(e) => onChange({ appUpdateUrl: e.target.value })} />
      </Field>
      <div className="flex items-center gap-3">
        <Button icon={RefreshCw} loading={checking} onClick={() => void check(false)}>
          Check for app update
        </Button>
        {available && <span className="text-sm" role="status">Version {available.version} is available.</span>}
        {message && <span className="text-sm text-muted" role="status" data-testid="app-update-message">{message}</span>}
      </div>
      {error && <ErrorNotice error={error} />}
    </Card>
  );
}
