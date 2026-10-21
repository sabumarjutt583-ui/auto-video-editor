import { useState } from "react";

import { Button, Modal } from "../ui";

interface PromptEditModalProps {
  sceneId: string;
  prompt: string;
  /** Saves the new prompt; `regenerate` also makes a new picture with it. */
  onSave: (prompt: string, regenerate: boolean) => void;
  onClose: () => void;
  /** Hide "Save prompt" when saving always means making a new picture. */
  saveOnly?: boolean;
}

export function PromptEditModal({ sceneId, prompt, onSave, onClose, saveOnly = true }: PromptEditModalProps) {
  const [text, setText] = useState(prompt);
  const empty = text.trim() === "";
  return (
    <Modal title={`Edit prompt ${sceneId}`} onClose={onClose} wide>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        aria-label={`Prompt for ${sceneId}`}
        className="w-full rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg focus:border-accent"
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        {saveOnly && (
          <Button disabled={empty} onClick={() => onSave(text.trim(), false)}>
            Save prompt
          </Button>
        )}
        <Button variant="primary" disabled={empty} onClick={() => onSave(text.trim(), true)}>
          Save and make a new picture
        </Button>
      </div>
    </Modal>
  );
}
