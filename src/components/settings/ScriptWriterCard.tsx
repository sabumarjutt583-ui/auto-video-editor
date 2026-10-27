import { PenLine, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { toAppError } from "../../lib/errors";
import { SCRIPT_CONSENT_CHECKBOX, SCRIPT_CONSENT_POINTS, SCRIPT_CONSENT_TITLE } from "../../lib/script/consent";
import {
  scriptAcceptConsent,
  scriptAccountCheck,
  scriptAccountConfirmSignedIn,
  scriptAccountDisconnect,
  scriptAccountSignIn,
  scriptAccounts,
  scriptAddAccount,
  scriptDeleteAccount,
  type ScriptAccountStatus,
} from "../../lib/script/api";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Checkbox, Modal, TextInput } from "../ui";

/**
 * Settings: the Claude accounts that write scripts (and nothing else). Each account has its
 * own browser profile and sign-in, like the Google accounts for pictures. When one account's
 * usage limit ends, a script question moves on to the next connected account by itself.
 * The first account is the original single sign-in, kept exactly as it was.
 */
export function ScriptWriterCard() {
  const [accounts, setAccounts] = useState<ScriptAccountStatus[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [working, setWorking] = useState("");
  const [name, setName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await scriptAccounts());
    } catch (caught) {
      setError(toAppError(caught, "The script writer could not be read."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(kind: string, action: () => Promise<unknown>) {
    setError(null);
    setWorking(kind);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(toAppError(caught, "That did not work."));
      await load();
    } finally {
      setWorking("");
    }
  }

  async function accept() {
    setAsking(false);
    setUnderstood(false);
    try {
      await scriptAcceptConsent();
      await load();
    } catch (caught) {
      setError(toAppError(caught, "The notice could not be saved."));
    }
  }

  async function add() {
    const trimmed = name.trim();
    await run("add", async () => {
      await scriptAddAccount(trimmed === "" ? undefined : trimmed);
      setName("");
    });
  }

  const consent = accounts !== null && accounts.length > 0 ? accounts[0].consent : false;

  return (
    <Card title="Script writer (Claude, optional)" description="Writes the script of a video from a topic and the channel's master prompt. Uses your own Claude accounts in their normal chat pages, only for scripts. When one account's usage limit ends, the next connected account is used." icon={PenLine}>
      {error && <ErrorNotice error={error} />}
      {accounts === null && <p className="text-sm">Reading…</p>}
      {accounts !== null && !consent && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setAsking(true)}>
            Read the notice and set up
          </Button>
        </div>
      )}
      {accounts !== null && consent && (
        <>
          {accounts.length === 0 && <p className="text-sm text-muted">No account yet. Add one, then press Sign in.</p>}
          <ul className="flex flex-col gap-2">
            {accounts.map((account) => {
              const limit = account.limitedUntil > Date.now() ? new Date(account.limitedUntil).toLocaleTimeString() : null;
              const line = working === `sign-in:${account.id}` ? "Sign-in window is open" : account.connected ? "Connected" : "Not signed in";
              return (
                <li key={account.id} className="flex flex-col gap-1.5 rounded border border-subtle p-3">
                  <p className="text-sm">
                    <strong>{account.name}</strong> · {line}
                    {limit ? ` · resting until ${limit} (usage limit)` : ""}
                  </p>
                  {!account.connected && account.lastError && <p className="text-xs text-muted">{account.lastError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" loading={working === `sign-in:${account.id}`} disabled={working !== ""} onClick={() => void run(`sign-in:${account.id}`, () => scriptAccountSignIn(account.id))}>
                      Sign in to Claude
                    </Button>
                    {working === `sign-in:${account.id}` && <Button onClick={() => void scriptAccountConfirmSignedIn(account.id)}>I have signed in</Button>}
                    <Button loading={working === `check:${account.id}`} disabled={working !== ""} onClick={() => void run(`check:${account.id}`, () => scriptAccountCheck(account.id))}>
                      Check the connection
                    </Button>
                    <Button disabled={working !== "" || !account.connected} onClick={() => void run(`disconnect:${account.id}`, () => scriptAccountDisconnect(account.id))}>
                      Disconnect
                    </Button>
                    {confirmingDelete === account.id ? (
                      <>
                        <Button variant="primary" disabled={working !== ""} onClick={() => void run(`delete:${account.id}`, async () => {
                          await scriptDeleteAccount(account.id);
                          setConfirmingDelete(null);
                        })}>
                          Yes, delete this account
                        </Button>
                        <Button disabled={working !== ""} onClick={() => setConfirmingDelete(null)}>
                          Keep it
                        </Button>
                      </>
                    ) : (
                      <Button disabled={working !== ""} onClick={() => setConfirmingDelete(account.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, for example Claude 2" aria-label="New Claude account name" maxLength={40} />
            <Button type="submit" icon={Plus} loading={working === "add"} disabled={working !== ""}>
              Add account
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAsking(true)}>Read the notice again</Button>
          </div>
        </>
      )}
      {asking && (
        <Modal title={SCRIPT_CONSENT_TITLE} onClose={() => setAsking(false)}>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {SCRIPT_CONSENT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {consent ? (
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
