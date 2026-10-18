import { TriangleAlert } from "lucide-react";

import { Button, Modal } from "../ui";

interface UnlockDialogProps {
  onConfirm: () => void;
  onClose: () => void;
}

/** Warns before the voice is unlocked, because that clears everything built on its timing. */
export function UnlockDialog({ onConfirm, onClose }: UnlockDialogProps) {
  return (
    <Modal title="Unlock the voice?" onClose={onClose}>
      <p className="flex items-start gap-2 text-sm">
        <TriangleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-danger" />
        <span>
          Unlocking clears the <strong>word timings, scenes and prompts</strong> of this project, because they depend on the
          exact voice. Your script, style and character descriptions are kept.
        </span>
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} autoFocus>
          Keep it locked
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Unlock and clear
        </Button>
      </div>
    </Modal>
  );
}
