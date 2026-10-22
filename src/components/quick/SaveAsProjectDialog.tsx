import { useState } from "react";

import { Button, Field, Modal, TextInput } from "../ui";

interface SaveAsProjectDialogProps {
  busy: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}

/** Asks for a project name before the quick session becomes a project. */
export function SaveAsProjectDialog({ busy, onSave, onClose }: SaveAsProjectDialogProps) {
  const [name, setName] = useState("");
  return (
    <Modal title="Save as project" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() !== "") onSave(name.trim());
        }}
      >
        <Field label="Project name" htmlFor="quick-project-name" hint="Your script, voice, timing, scenes, cast, style and prompts move into this project.">
          <TextInput id="quick-project-name" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={name.trim() === ""}>
            Save as project
          </Button>
        </div>
      </form>
    </Modal>
  );
}
