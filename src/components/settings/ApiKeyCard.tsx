import { CircleCheck, ExternalLink as ExternalLinkIcon, FlaskConical, KeyRound, Save, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { toAppError } from "../../lib/errors";
import { testKey } from "../../lib/keys";
import { openExternalLink, type ExternalLink } from "../../lib/links";
import { useKeyStore } from "../../store/keyStore";
import type { AppError, Provider } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { KeyStatusBadge } from "./KeyStatusBadge";
import { SecretInput } from "./SecretInput";

type Busy = "save" | "test" | "delete";

type Outcome =
  | { kind: "saved" }
  | { kind: "works" }
  | { kind: "deleted" }
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

/** Save, test and delete the API key of one provider. The saved key is never shown again. */
export function ApiKeyCard({ provider, title, description, linkLabel, link, testModel }: ApiKeyCardProps) {
  const inputId = useId();
  const status = useKeyStore((state) => state.status[provider]);
  const save = useKeyStore((state) => state.save);
  const remove = useKeyStore((state) => state.remove);

  // The key being typed lives only here, and is cleared as soon as it is saved.
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Busy | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isSet = status === "set";
  const hasDraft = draft.trim().length > 0;

  async function run(action: Busy, job: () => Promise<Outcome>) {
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
    void run("save", async () => {
      await save(provider, draft);
      setDraft("");
      return { kind: "saved" };
    });
  };

  const handleTest = () =>
    run("test", async () => {
      await testKey(provider, testModel);
      return { kind: "works" };
    });

  const handleDelete = () =>
    run("delete", async () => {
      await remove(provider);
      setConfirmingDelete(false);
      return { kind: "deleted" };
    });

  const handleOpenLink = async () => {
    try {
      await openExternalLink(link);
    } catch (error) {
      setOutcome({ kind: "error", error: toAppError(error) });
    }
  };

  const testHint = !isSet ? "Save a key first" : hasDraft ? "Save the new key first" : "Check that the saved key works";

  return (
    <Card title={title} description={description} icon={KeyRound}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={inputId} className="text-sm font-medium">
            API key
          </label>
          <KeyStatusBadge status={status} />
        </div>
        <SecretInput
          id={inputId}
          value={draft}
          onChange={setDraft}
          onSubmit={handleSave}
          placeholder={isSet ? "Key saved. Paste a new key here to replace it." : "Paste your key here"}
          disabled={busy !== null}
        />
        <button
          type="button"
          onClick={() => void handleOpenLink()}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium text-accent-fg hover:underline"
        >
          {linkLabel}
          <ExternalLinkIcon size={12} aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Save} onClick={handleSave} disabled={!hasDraft || busy !== null} loading={busy === "save"}>
          Save
        </Button>
        <Button
          icon={FlaskConical}
          onClick={() => void handleTest()}
          disabled={!isSet || hasDraft || busy !== null}
          loading={busy === "test"}
          title={testHint}
        >
          Test Key
        </Button>
        {confirmingDelete ? (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-muted">Delete this key?</span>
            <Button variant="danger" onClick={() => void handleDelete()} loading={busy === "delete"} disabled={busy !== null}>
              Yes, delete
            </Button>
            <Button onClick={() => setConfirmingDelete(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => setConfirmingDelete(true)}
            disabled={!isSet || busy !== null}
            title={isSet ? "Remove the saved key" : "There is no saved key"}
          >
            Delete
          </Button>
        )}
      </div>

      <div aria-live="polite">{outcome && <OutcomeMessage outcome={outcome} />}</div>
    </Card>
  );
}

function OutcomeMessage({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case "works":
      return (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheck size={16} aria-hidden /> Key works
        </p>
      );
    case "saved":
      return (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CircleCheck size={16} aria-hidden /> Key saved. Press Test Key to check it.
        </p>
      );
    case "deleted":
      return <p className="text-sm text-muted">Key deleted.</p>;
    case "error":
      return <ErrorNotice error={outcome.error} />;
  }
}
