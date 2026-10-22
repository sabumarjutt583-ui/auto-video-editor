import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui";

interface DeleteImagesBarProps {
  /** Pictures that can be deleted now (finished, with a file). */
  total: number;
  /** Selected cards that have a picture. */
  selected: number;
  busy: boolean;
  onDelete: (which: "selected" | "all") => void;
}

/** "Delete selected" and "Delete all images", with a confirmation that shows the count. The files go to the Recycle Bin / Trash. */
export function DeleteImagesBar({ total, selected, busy, onDelete }: DeleteImagesBarProps) {
  const [ask, setAsk] = useState<"selected" | "all" | null>(null);
  const count = ask === "all" ? total : selected;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Trash2} variant="danger" disabled={busy || selected === 0} onClick={() => setAsk("selected")}>
          Delete selected{selected > 0 ? ` (${selected})` : ""}
        </Button>
        <Button icon={Trash2} variant="danger" disabled={busy || total === 0} onClick={() => setAsk("all")}>
          Delete all images{total > 0 ? ` (${total})` : ""}
        </Button>
      </div>
      {ask && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Delete pictures">
          <p className="text-sm">
            Move {count} {count === 1 ? "picture" : "pictures"} to the Recycle Bin? They will not be made again unless you generate them again.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setAsk(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const which = ask;
                setAsk(null);
                onDelete(which);
              }}
            >
              Delete {count}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
