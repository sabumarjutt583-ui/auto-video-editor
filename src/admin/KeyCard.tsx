import { KeyRound } from "lucide-react";
import { useState } from "react";

import { Button, Card, TextInput } from "../components/ui";
import { adminDeleteKey, adminSaveKey } from "./api";

interface Props {
  keySet: boolean;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

/** The Freesound key. It goes to the OS keychain and is never shown again. */
export function KeyCard({ keySet, act }: Props) {
  const [key, setKey] = useState("");
  return (
    <Card title="Freesound key" description="Saved only in the system keychain of this computer." icon={KeyRound}>
      <p className="text-sm" data-testid="admin-key-status">{keySet ? "A key is saved." : "No key saved yet."}</p>
      <div className="flex gap-2">
        <TextInput type="password" aria-label="Freesound API key" placeholder="Paste the key" value={key} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
        <Button variant="primary" disabled={key.trim() === ""} onClick={() => void act(() => adminSaveKey(key)).then(() => setKey(""))}>
          Save
        </Button>
        {keySet && (
          <Button variant="danger" onClick={() => void act(adminDeleteKey)}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}
