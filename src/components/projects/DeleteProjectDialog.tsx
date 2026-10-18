import { useState } from "react";

import { toAppError } from "../../lib/errors";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Modal } from "../ui";

interface DeleteProjectDialogProps {
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Asks before a project is deleted for good. */
export function DeleteProjectDialog({ name, onConfirm, onClose }: DeleteProjectDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(toAppError(caught, "The project could not be deleted."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete this project?" onClose={busy ? () => undefined : onClose}>
      <p className="text-sm [overflow-wrap:anywhere]">
        “{name}” and everything saved inside it (voice-over copy, media copies and exported videos) will be
        deleted from this computer. This cannot be undone.
      </p>
      <p className="text-xs text-muted">Your original files outside the project folder are not touched.</p>
      {error && <ErrorNotice error={error} />}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button variant="danger" loading={busy} onClick={() => void handleConfirm()}>
          Delete project
        </Button>
      </div>
    </Modal>
  );
}
