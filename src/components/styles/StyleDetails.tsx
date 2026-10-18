import { Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { missingFields, REQUIRED_FIELDS } from "../../lib/styleModel";
import type { StyleProfile } from "../../types";
import { Button } from "../ui";

interface StyleDetailsProps {
  style: StyleProfile;
  /** This is the style the project uses. */
  inUse: boolean;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</h4>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{text === "" ? <span className="text-muted">Empty</span> : text}</p>
    </div>
  );
}

/** The main parts of a style, and what is still missing when it is a placeholder. */
export function StyleDetails({ style, inUse, onDuplicate, onEdit, onDelete }: StyleDetailsProps) {
  const [more, setMore] = useState(false);
  const missing = missingFields(style);
  const complete = missing.length === 0;
  const shownFirst = ["core_identity", "color_palette", "lighting", "example_prompt"];

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2 p-5" aria-label="Style details">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{style.name}</h3>
          <span className="text-xs text-muted">{style.category}</span>
          {!style.builtin && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">Custom</span>}
          {inUse && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">Used in this project</span>}
          {!complete && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">Incomplete</span>}
        </div>
        <div className="flex gap-2">
          <Button icon={Copy} onClick={onDuplicate}>
            Duplicate
          </Button>
          {!style.builtin && (
            <>
              <Button icon={Pencil} onClick={onEdit}>
                Edit
              </Button>
              <Button variant="danger" icon={Trash2} onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {!complete && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="note">
          This style cannot be used for generation yet. Still empty: {missing.join(", ")}. Duplicate it and fill the fields in, or paste a full profile into its file in the styles folder.
        </p>
      )}

      {REQUIRED_FIELDS.filter((f) => shownFirst.includes(f.key)).map((f) => (
        <Block key={f.key} label={f.label} text={style[f.key]} />
      ))}

      <button type="button" onClick={() => setMore((state) => !state)} aria-expanded={more} className="w-fit cursor-pointer text-sm text-accent-fg hover:underline">
        {more ? "Hide the other fields" : "Show all fields"}
      </button>
      {more && REQUIRED_FIELDS.filter((f) => !shownFirst.includes(f.key)).map((f) => <Block key={f.key} label={f.label} text={style[f.key]} />)}
    </div>
  );
}
