import { PenLine } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { toAppError } from "../../lib/errors";
import { SCRIPT_CONSENT_CHECKBOX, SCRIPT_CONSENT_POINTS, SCRIPT_CONSENT_TITLE } from "../../lib/script/consent";
import { scriptAcceptConsent, scriptCheck, scriptConfirmSignedIn, scriptDisconnect, scriptSignIn, scriptStatus, type ScriptStatus } from "../../lib/script/api";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Checkbox, Modal } from "../ui";

/** Settings: the Claude account that writes scripts (and nothing else). */
export function ScriptWriterCard() {
  const [status, setStatus] = useState<ScriptStatus | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [working, setWorking] = useState<"" | "sign-in" | "check">("");
  const [asking, setAsking] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await scriptStatus());
    } catch (caught) {
      setError(toAppError(caught, "The script writer could not be read."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(kind: "sign-in" | "check", action: () => Promise<ScriptStatus>) {
    setError(null);
    setWorking(kind);
    try {
      setStatus(await action());
    } catch (caught) {
      setError(toAppError(caught, kind === "sign-in" ? "The sign-in could not be finished." : "Claude could not be checked."));
      await load();
    } finally {
      setWorking("");
    }
  }

  async function accept() {
    setAsking(false);
    setUnderstood(false);
    try {
      setStatus(await scriptAcceptConsent());
    } catch (caught) {
      setError(toAppError(caught, "The notice could not be saved."));
    }
  }

  async function disconnect() {
    setError(null);
    try {
      setStatus(await scriptDisconnect());
    } catch (caught) {
      setError(toAppError(caught, "Claude could not be disconnected."));
    }
  }

  const limit = status && status.limitedUntil > Date.now() ? new Date(status.limitedUntil).toLocaleTimeString() : null;
  const line = !status ? "Reading…" : !status.consent ? "Not set up" : working === "sign-in" ? "Sign-in window is open" : status.connected ? "Connected" : "Not signed in";

  return (
    <Card title="Script writer (Claude, optional)" description="Writes the script of a video from a topic and the channel's master prompt. Uses your own Claude account in its normal chat page, only for scripts." icon={PenLine}>
      {error && <ErrorNotice error={error} />}
      <p className="text-sm">
        Status: <strong>{line}</strong>
        {limit ? ` · resting until ${limit} (usage limit)` : ""}
      </p>
      {status && !status.connected && status.lastError && <p className="text-xs text-muted">{status.lastError}</p>}
      <div className="flex flex-wrap gap-2">
        {status && !status.consent && (
          <Button variant="primary" onClick={() => setAsking(true)}>
            Read the notice and set up
          </Button>
        )}
        {status?.consent && (
          <>
            <Button variant="primary" loading={working === "sign-in"} disabled={working !== ""} onClick={() => void run("sign-in", scriptSignIn)}>
              Sign in to Claude
            </Button>
            {working === "sign-in" && <Button onClick={() => void scriptConfirmSignedIn()}>I have signed in</Button>}
            <Button loading={working === "check"} disabled={working !== ""} onClick={() => void run("check", scriptCheck)}>
              Check the connection
            </Button>
            <Button disabled={working !== "" || !status.connected} onClick={() => void disconnect()}>
              Disconnect
            </Button>
            <Button onClick={() => setAsking(true)}>Read the notice again</Button>
          </>
        )}
      </div>
      {asking && (
        <Modal title={SCRIPT_CONSENT_TITLE} onClose={() => setAsking(false)}>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {SCRIPT_CONSENT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {status?.consent ? (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setAsking(false)}>
                Close
              </Button>
            </div>
          ) : (
            <>
              <Checkbox label={SCRIPT_CONSENT_CHECKBOX} checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <div className="flex justify-end gap-2">
                <Button onClick={() => setAsking(false)}>Cancel</Button>
                <Button variant="primary" disabled={!understood} onClick={() => void accept()}>
                  Continue
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </Card>
  );
}
