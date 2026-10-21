import { useState } from "react";

import { CONSENT_CHECKBOX, CONSENT_POINTS, CONSENT_TITLE } from "../../lib/imagegen/consent";
import { Button, Checkbox, Modal } from "../ui";

interface ConsentDialogProps {
  /** `true` when it is opened only to read again (Settings): nothing is stored. */
  readOnly?: boolean;
  onAccept: () => void;
  onClose: () => void;
}

/** The one-time notice before the free engine (your own Google account) is used. */
export function ConsentDialog({ readOnly = false, onAccept, onClose }: ConsentDialogProps) {
  const [understood, setUnderstood] = useState(false);
  return (
    <Modal title={CONSENT_TITLE} onClose={onClose}>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
        {CONSENT_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {readOnly ? (
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <>
          <Checkbox label={CONSENT_CHECKBOX} checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!understood} onClick={onAccept}>
              Continue
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
