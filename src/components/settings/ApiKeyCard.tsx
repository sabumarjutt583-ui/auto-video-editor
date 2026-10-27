import { CircleCheck, ExternalLink as ExternalLinkIcon, FlaskConical, KeyRound, Save, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { toAppError } from "../../lib/errors";
import { restText, setKeyRestUntil, slotForNewKey, slotsFull, testKey } from "../../lib/keys";
import { openExternalLink, type ExternalLink } from "../../lib/links";
import { useKeyStore } from "../../store/keyStore";
import type { AppError, KeySlotInfo, Provider } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { KeyStatusBadge } from "./KeyStatusBadge";
import { SecretInput } from "./SecretInput";

type Outcome =
  | { kind: "saved"; slot: number }
  | { kind: "works"; slot: number }
  | { kind: "deleted"; slot: number }
  | { kind: "error"; error: AppError };

interface ApiKeyCardProps {
  provider: Provider;
  title: string;
  description: string;
  linkLabel: string;
  link: ExternalLink;
  /** Gemini only: the model name currently chosen in the settings, used for the test (OpenAI and Groq lists need none). */
  testModel?: string;
}

/** Save, test and delete the API keys of one provider. With several keys the next one is used when one reaches its limit. The saved keys are never shown again. */
export function ApiKeyCard({ provider, title, description, linkLabel, link, testModel }: ApiKeyCardProps) {
  const inputId = useId();
  const status = useKeyStore((state) => state.status[provider]);
  const slots = useKeyStore((state) => state.slots[provider]);
  const save = useKeyStore((state) => state.save);
  const remove = useKeyStore((state) => state.remove);

  // The key being typed lives only here, and is cleared as soon as it is saved.
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);

  const saved = slots.filter((s) => s.status === "set");
  const hasDraft = draft.trim().length > 0;
  const full = slotsFull(slots);
  const several = slots.length > 1;

  async function run(action: string, job: () => Promise<Outcome>) {
    setBusy(action);
    setOutcome(null);
    try {
      setOutcome(await job());
    } catch (error) {
      setOutcome({ kind: "error", error: toAppError(error) });
    } finally {
      setBusy(null);
    }
  }

  const handleSave = () => {
    if (!hasDraft || busy) return;
    const slot = slotForNewKey(slots);
    void run("save", async () => {
      await save(provider, draft, slot);
      setDraft("");
      return { kind: "saved", slot };
    });
  };

  const handleTest = (slot: number) =>
    run(`test-${slot}`, async () => {
      await testKey(provider, testModel, slot);
      return { kind: "works", slot };
    });

  const handleDelete = (slot: number) =>
    run(`delete-${slot}`, async () => {
      await remove(provider, slot);
      setConfirmingDelete(null);
      return { kind: "deleted", slot };
    });

  const handleOpenLink = async () => {
    try {
      await openExternalLink(link);
    } catch (error) {
      setOutcome({ kind: "error", error: toAppError(error) });
    }
  };

  const label = !several ? "API key" : full ? "Replace the last key" : saved.length > 0 ? "Add another key" : "API key";
  const placeholder =
    saved.length === 0
      ? "Paste your key here"
      : several && !full
      ? "Paste another key here. When one key reaches its limit, the next one is used."
      : "Paste a new key here to replace the saved one.";

  return (
    <Card title={title} description={description} icon={KeyRound}>
      {saved.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Saved keys">
          {saved.map((entry) => (
            <KeyRow
              key={entry.slot}
              entry={entry}
              provider={provider}
              numbered={several}
              busy={busy}
              confirming={confirmingDelete === entry.slot}
              onTest={() => void handleTest(entry.slot)}
              onAskDelete={() => setConfirmingDelete(entry.slot)}
              onCancelDelete={() => setConfirmingDelete(null)}
              onDelete={() => void handleDelete(entry.slot)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={inputId} className="text-sm font-medium">
            {label}
          </label>
          {saved.length === 0 && <KeyStatusBadge status={status} />}
        </div>
        <SecretInput id={inputId} value={draft} onChange={setDraft} onSubmit={handleSave} placeholder={placeholder} disabled={busy !== null} />
        <button
          type="button"
          onClick={() => void handleOpenLink()}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium text-accent-fg hover:underline"
        >
          {linkLabel}
          <ExternalLinkIcon size={12} aria-hidden />
        </button>
        {several && (
          <p className="text-xs text-muted">
            You can save up to {slots.length} keys (for example from different Google accounts). The first key is used until it reaches its limit, then the next one takes over by itself.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Save} onClick={handleSave} disabled={!hasDraft || busy !== null} loading={busy === "save"}>
          Save
        </Button>
      </div>

      <div aria-live="polite">{outcome && <OutcomeMessage outcome={outcome} numbered={several} />}</div>
    </Card>
  );
}

interface KeyRowProps {
  entry: KeySlotInfo;
  provider: Provider;
  numbered: boolean;
  busy: string | null;
  confirming: boolean;
  onTest: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function KeyRow({ entry, provider, numbered, busy, confirming, onTest, onAskDelete, onCancelDelete, onDelete }: KeyRowProps) {
  const name = numbered ? `Key ${entry.slot}` : "Saved key";
  const refresh = useKeyStore((state) => state.refresh);
  const [backOnline, setBackOnline] = useState("");
  const [setting, setSetting] = useState(false);
  const toLocalInput = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const setLimit = async (clear: boolean) => {
    const untilMs = clear ? 0 : backOnline ? new Date(backOnline).getTime() : 0;
    if (!clear && (!Number.isFinite(untilMs) || untilMs <= Date.now())) return;
    setSetting(true);
    try {
      await setKeyRestUntil(provider, entry.slot, untilMs);
      await refresh(provider);
      setBackOnline("");
    } finally {
      setSetting(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <span className="text-sm font-medium">{name}</span>
      {entry.restingSeconds > 0 ? (
        <span className="text-xs text-warning">Resting after its limit ({restText(entry.restingSeconds)} left)</span>
      ) : (
        <KeyStatusBadge status="set" />
      )}
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor={`key-back-${provider}-${entry.slot}`} className="text-muted">
          Back online at:
        </label>
        <input
          id={`key-back-${provider}-${entry.slot}`}
          type="datetime-local"
          className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs"
          value={backOnline || (entry.restingUntilMs && entry.restingUntilMs > Date.now() ? toLocalInput(entry.restingUntilMs) : "")}
          onChange={(e) => setBackOnline(e.target.value)}
        />
        <Button disabled={setting || busy !== null} onClick={() => void setLimit(false)}>
          Set time
        </Button>
        {entry.restingSeconds > 0 && (
          <Button disabled={setting || busy !== null} onClick={() => void setLimit(true)}>
            Clear rest
          </Button>
        )}
      </span>
      <span className="ml-auto inline-flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm text-muted">Delete this key?</span>
            <Button variant="danger" onClick={onDelete} loading={busy === `delete-${entry.slot}`} disabled={busy !== null}>
              Yes, delete
            </Button>
            <Button onClick={onCancelDelete} disabled={busy !== null}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button icon={FlaskConical} onClick={onTest} disabled={busy !== null} loading={busy === `test-${entry.slot}`} title="Check that this key works">
              Test Key
            </Button>
            <Button variant="danger" icon={Trash2} onClick={onAskDelete} disabled={busy !== null} title="Remove this key">
              Delete
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

function OutcomeMessage({ outcome, numbered }: { outcome: Outcome; numbered: boolean }) {
  const which = (slot: number) => (numbered ? `Key ${slot}` : "Key");
  switch (outcome.kind) {
    case "works":
      return (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheck size={16} aria-hidden /> {which(outcome.slot)} works
        </p>
      );
    case "saved":
      return (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheck size={16} aria-hidden /> {which(outcome.slot)} saved. Press Test Key to check it.
        </p>
      );
    case "deleted":
      return <p className="text-sm text-muted">{which(outcome.slot)} deleted.</p>;
    case "error":
      return <ErrorNotice error={outcome.error} />;
  }
}
