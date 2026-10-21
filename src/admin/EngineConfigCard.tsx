import { FlaskConical, Save, Settings2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { ErrorNotice } from "../components/ErrorNotice";
import { TestImageModal } from "../components/imagegen/TestImageModal";
import { Button, Card, Field, Select } from "../components/ui";
import { toAppError } from "../lib/errors";
import { useImageGenStore } from "../store/imagegenStore";
import type { AppError } from "../types";
import { adminReadEngineConfig, adminSaveEngineConfig } from "./api";

/** Edit the free engine's settings file (addresses, selectors, timings) and try one real picture with it. */
export function EngineConfigCard() {
  const accountsId = useId();
  const accounts = useImageGenStore((state) => state.snapshot?.accounts ?? []);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [account, setAccount] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void useImageGenStore.getState().init();
    adminReadEngineConfig().then(setText).catch((failure: unknown) => setError(toAppError(failure, "The engine settings could not be read.")));
  }, []);

  const chosen = accounts.find((a) => a.id === account) ?? accounts[0];

  async function save(useNow: boolean) {
    setError(null);
    setStatus("");
    try {
      const version = await adminSaveEngineConfig(text, useNow);
      setStatus(`Saved version ${version}${useNow ? " and now used by this app" : ""}. Build the package to publish it.`);
    } catch (failure) {
      setError(toAppError(failure, "The engine settings were not saved."));
    }
  }

  return (
    <Card title="Engine config" description="The settings of the free engine (config.json). Raise the major number of configVersion when users must accept the notice again." icon={Settings2}>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={18}
        aria-label="Engine config JSON"
        className="w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-fg focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Save} onClick={() => void save(false)}>
          Save
        </Button>
        <Button variant="primary" icon={Save} onClick={() => void save(true)}>
          Save and use now
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Account for the test" htmlFor={accountsId}>
          <Select id={accountsId} value={chosen?.id ?? ""} onChange={(event) => setAccount(event.target.value)} disabled={accounts.length === 0}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button icon={FlaskConical} disabled={!chosen} onClick={() => setTesting(true)}>
          Test free engine
        </Button>
      </div>
      {accounts.length === 0 && <p className="text-xs text-muted">Add and sign in an account on the Image Generator page first.</p>}
      {status && <p role="status" className="text-sm text-success">{status}</p>}
      {error && <ErrorNotice error={error} />}
      {testing && chosen && <TestImageModal accountId={chosen.id} accountName={chosen.name} onClose={() => setTesting(false)} />}
    </Card>
  );
}
