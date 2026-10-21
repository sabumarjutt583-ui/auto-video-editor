import { Eye, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { imagegenBackgroundSnapshot, imagegenShowBrowser } from "../../lib/imagegen/api";
import { Button, Modal } from "../ui";

/** A picture of what the hidden browser of this account shows now. For finding out why something waits. */
export function BackgroundBrowserModal({ accountId, accountName, onClose }: { accountId: string; accountName: string; onClose: () => void }) {
  const [shot, setShot] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const result = await imagegenBackgroundSnapshot(accountId).catch(() => null);
    setShot(result);
    setEmpty(result === null);
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function show() {
    const shown = await imagegenShowBrowser(accountId).catch(() => false);
    setNote(shown ? "The browser window is now in front of the app." : "There is no background browser to show. It starts when the next picture is made.");
  }

  return (
    <Modal title={`Background browser: ${accountName}`} onClose={onClose} wide>
      {shot && <img src={shot} alt="The background browser" className="w-full rounded-lg border border-line" />}
      {empty && <p className="text-sm text-muted">No background browser is running for this account right now.</p>}
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="flex justify-end gap-2">
        <Button icon={RefreshCw} onClick={() => void refresh()}>
          Refresh
        </Button>
        <Button icon={Eye} onClick={() => void show()}>
          Show the window
        </Button>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
