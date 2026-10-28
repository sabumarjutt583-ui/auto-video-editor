import { MessageSquare, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { toAppError } from "../../lib/errors";
import { CHATGPT_CONSENT_CHECKBOX, CHATGPT_CONSENT_POINTS, CHATGPT_CONSENT_TITLE } from "../../lib/chatgpt/consent";
import {
  chatgptAcceptConsent,
  chatgptAccountCheck,
  chatgptAccountConfirmSignedIn,
  chatgptAccountDisconnect,
  chatgptAccountSetLimit,
  chatgptAccountSignIn,
  chatgptAccounts,
  chatgptAddAccount,
  chatgptDeleteAccount,
  type ChatGptAccountStatus,
} from "../../lib/chatgpt/api";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Checkbox, Modal, TextInput } from "../ui";

/**
 * Settings: the ChatGPT accounts that study reference pictures for custom styles, and
 * nothing else. Each account has its own browser profile and sign-in, like the Google
 * accounts for pictures and the Claude accounts for scripts. No API key is needed: when
 * one account's usage limit ends, a style question moves on to the next connected account
 * by itself. A saved OpenAI key, if one was ever saved, is left untouched in the keychain
 * and is simply no longer used.
 */
export function ChatGptCard() {
  const [accounts, setAccounts] = useState<ChatGptAccountStatus[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [working, setWorking] = useState("");
  const [name, setName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [backOnline, setBackOnline] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [understood, setUnderstood] = useState(false);
  // With no accounts yet the list carries no consent flag, so remember an acceptance in
  // this session too; a newly added account mirrors the saved consent flag anyway.
  const [consented, setConsented] = useState(false);

  /** "YYYY-MM-DDTHH:mm" in local time for a datetime-local input. */
  function toLocalInput(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function setLimit(account: ChatGptAccountStatus, clear: boolean) {
    const value = backOnline[account.id];
    const untilMs = clear ? 0 : value ? new Date(value).getTime() : account.limitedUntil;
    if (!clear && (!Number.isFinite(untilMs) || untilMs <= Date.now())) {
      setError({ message: "Pick a future time for when this account is back online.", details: "" } as AppError);
      return;
    }
    await run(`limit:${account.id}`, () => chatgptAccountSetLimit(account.id, untilMs));
  }

  const load = useCallback(async () => {
    try {
      setAccounts(await chatgptAccounts());
    } catch (caught) {
      setError(toAppError(caught, "The ChatGPT accounts could not be read."));
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
      await chatgptAcceptConsent();
      setConsented(true);
      await load();
    } catch (caught) {
      setError(toAppError(caught, "The notice could not be saved."));
    }
  }

  async function add() {
    const trimmed = name.trim();
    await run("add", async () => {
      await chatgptAddAccount(trimmed === "" ? undefined : trimmed);
      setName("");
    });
  }

  const consent = consented || (accounts !== null && accounts.length > 0 ? accounts[0].consent : false);

  return (
    <Card title="ChatGPT accounts (optional)" description="For custom styles: ChatGPT studies your reference pictures in its normal chat page, with no API key. When one account's usage limit ends, the next connected account is used." icon={MessageSquare}>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-muted" htmlFor={`chatgpt-back-online-${account.id}`}>
                      Back online at:
                    </label>
                    <input
                      id={`chatgpt-back-online-${account.id}`}
                      type="datetime-local"
                      className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs"
                      value={backOnline[account.id] ?? (account.limitedUntil > Date.now() ? toLocalInput(account.limitedUntil) : "")}
                      onChange={(e) => setBackOnline((prev) => ({ ...prev, [account.id]: e.target.value }))}
                    />
                    <Button loading={working === `limit:${account.id}`} disabled={working !== ""} onClick={() => void setLimit(account, false)}>
                      Set time
                    </Button>
                    <Button disabled={working !== "" || account.limitedUntil <= Date.now()} onClick={() => void setLimit(account, true)}>
                      Clear rest
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" loading={working === `sign-in:${account.id}`} disabled={working !== ""} onClick={() => void run(`sign-in:${account.id}`, () => chatgptAccountSignIn(account.id))}>
                      Sign in to ChatGPT
                    </Button>
                    {working === `sign-in:${account.id}` && <Button onClick={() => void chatgptAccountConfirmSignedIn(account.id)}>I have signed in</Button>}
                    <Button loading={working === `check:${account.id}`} disabled={working !== ""} onClick={() => void run(`check:${account.id}`, () => chatgptAccountCheck(account.id))}>
                      Check the connection
                    </Button>
                    <Button disabled={working !== "" || !account.connected} onClick={() => void run(`disconnect:${account.id}`, () => chatgptAccountDisconnect(account.id))}>
                      Disconnect
                    </Button>
                    {confirmingDelete === account.id ? (
                      <>
                        <Button
                          variant="primary"
                          disabled={working !== ""}
                          onClick={() =>
                            void run(`delete:${account.id}`, async () => {
                              await chatgptDeleteAccount(account.id);
                              setConfirmingDelete(null);
                            })
                          }
                        >
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
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, for example ChatGPT 2" aria-label="New ChatGPT account name" maxLength={40} />
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
        <Modal title={CHATGPT_CONSENT_TITLE} onClose={() => setAsking(false)}>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {CHATGPT_CONSENT_POINTS.map((point) => (
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
              <Checkbox label={CHATGPT_CONSENT_CHECKBOX} checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
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
