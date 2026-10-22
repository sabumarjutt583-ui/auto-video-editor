import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { placeholderCount, type GraphicPreset } from "../../../lib/graphics/editing";
import type { Scene } from "../../../types";
import { Button, TextInput } from "../../ui";
import type { GraphicEditing } from "./useGraphicEditing";

/** My Presets: graphics saved with placeholders for their texts. Insert one on the selected scene with your own words. */
export function PresetsPanel({ editing, scene }: { editing: GraphicEditing; scene: Scene | undefined }) {
  const [open, setOpen] = useState<string | null>(null);
  const [texts, setTexts] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  if (editing.presets.length === 0) return <p className="text-xs text-muted">My Presets is empty. Select a graphic and use "Save as preset".</p>;

  const insert = async (preset: GraphicPreset) => {
    if (!scene) return;
    const ok = await editing.insertPreset(preset, scene.id, texts);
    setNote(ok ? `Added to ${scene.id}.` : "This scene is too short for the graphic.");
    if (ok) setOpen(null);
  };
  return (
    <section className="flex flex-col gap-2" aria-label="My Presets">
      <h4 className="text-xs font-semibold">My Presets</h4>
      {editing.presets.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <div className="flex items-center justify-between text-xs">
            <span>{p.name}</span>
            <span className="flex gap-1">
              <button type="button" className="cursor-pointer rounded p-1 hover:text-fg disabled:opacity-40" aria-label={`Insert ${p.name}`} disabled={!scene || editing.job !== null} onClick={() => { setOpen(open === p.id ? null : p.id); setTexts(p.samples); setNote(null); }}><Plus className="h-4 w-4" /></button>
              <button type="button" className="cursor-pointer rounded p-1 hover:text-danger" aria-label={`Delete ${p.name}`} onClick={() => editing.deletePreset(p.id)}><Trash2 className="h-4 w-4" /></button>
            </span>
          </div>
          {open === p.id && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: placeholderCount(p) }, (_, i) => (
                <TextInput key={i} aria-label={`Text ${i + 1}`} value={texts[i] ?? ""} onChange={(e) => setTexts((old) => old.map((t, j) => (j === i ? e.target.value : t)))} />
              ))}
              <Button variant="primary" onClick={() => void insert(p)}>Add to {scene?.id}</Button>
            </div>
          )}
        </div>
      ))}
      {note && <p className="text-xs text-muted" role="status">{note}</p>}
    </section>
  );
}
