import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Cloud } from "lucide-react";
import { Button, Card } from "../ui";
import { ErrorNotice } from "../ErrorNotice";
import { toAppError } from "../../lib/errors";
import type { AppError } from "../../types";

interface Status { configured: boolean; connected: boolean; email?: string; quota?: { usage?: string; limit?: string } }
const size = (n?: string) => n ? `${(Number(n) / 1073741824).toFixed(1)} GB` : "Not reported";
export function GoogleDriveCard() {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const refresh = async () => setStatus(await invoke<Status>("google_status"));
  useEffect(() => { void refresh().catch(e => setError(toAppError(e, "Could not check Google connection."))); }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (e) { setError(toAppError(e, "Google connection failed.")); }
    finally { setBusy(false); }
  }
  return <Card title="Google Drive & Docs" icon={Cloud} description="Local saving is always available. Optionally connect Google to also save scripts in Google Docs.">
    <p className="text-sm text-muted">Local storage: on. A Google account is not required to save voice, pictures or projects.</p>
    <p>{status?.connected ? `Connected: ${status.email ?? "Google account"}` : "Google account is not connected."}</p>
    {status?.connected && <p>Storage used: {size(status.quota?.usage)} / {size(status.quota?.limit)}</p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy} onClick={() => void run(async () => {
        const path = await open({ multiple: false, filters: [{ name: "Google credentials", extensions: ["json"] }] });
        if (typeof path === "string") await invoke("google_import_credentials", { path });
      })}>Import credentials JSON</Button>
      <Button disabled={busy || !status?.configured} onClick={() => void run(async () => { await invoke("google_connect"); })}>{busy ? "Please wait…" : "Connect Google"}</Button>
      <Button disabled={busy} onClick={() => void run(async () => {})}>Check connection</Button>
      {status?.connected && <Button disabled={busy} onClick={() => void run(async () => { await invoke("google_disconnect"); })}>Disconnect</Button>}
    </div>
    <p className="text-sm text-muted">After connecting, use Open Document on a project. Voice, pictures and video uploads are not enabled yet; project files remain on this computer.</p>
    {error && <ErrorNotice error={error} />}
  </Card>;
}
