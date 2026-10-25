import { useState, type FormEvent } from "react";

import { toAppError } from "../../lib/errors";
import { MAX_PROJECT_NAME_LENGTH, validateProjectName } from "../../lib/projectList";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Field, Modal, Select, TextInput } from "../ui";

interface NameDialogProps {
  title: string;
  confirmLabel: string;
  initialName: string;
  /** Does the work. Throw to keep the dialog open and show the error. */
  onSubmit: (name: string, channelId: string) => Promise<void>;
  /** When given, the person also chooses the channel of the project ("" = no channel). */
  channels?: readonly { id: string; name: string }[];
  initialChannelId?: string;
  onClose: () => void;
}

/** Asks for a project name. Used for "New project" and "Rename". */
export function NameDialog({ title, confirmLabel, initialName, onSubmit, channels, initialChannelId = "", onClose }: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [channelId, setChannelId] = useState(initialChannelId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nameProblem = validateProjectName(name);
    setProblem(nameProblem);
    if (nameProblem) return;

    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim(), channelId);
    } catch (caught) {
      setError(toAppError(caught, "The project could not be saved."));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
        <Field label={channels ? "Video title" : "Project name"} htmlFor="project-name">
          <TextInput
            id="project-name"
            value={name}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_PROJECT_NAME_LENGTH * 2}
            aria-invalid={problem !== null}
            onFocus={(event) => event.target.select()}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
          {problem && <p className="text-xs text-danger">{problem}</p>}
        </Field>
        {channels && (
          <Field label="Channel" htmlFor="project-channel" hint="The video takes this channel's voice, style, captions and music settings.">
            <Select id="project-channel" value={channelId} disabled={busy} onChange={(event) => setChannelId(event.target.value)}>
              <option value="">No channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && <ErrorNotice error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
