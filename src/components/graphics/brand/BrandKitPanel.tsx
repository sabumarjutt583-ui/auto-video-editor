import { Copy, Globe, Save, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { type BrandKit, isBuiltinKit, SUGGESTED_KITS, themeOfKit } from "../../../lib/graphics/brand";
import { Button, Field, Select } from "../../ui";
import { KitEditor } from "./KitEditor";
import { KitSamples } from "./KitSamples";
import { MATCH_STYLE, type BrandKitView } from "./useBrandKit";

/** Pick, edit and save the brand kit (colours, fonts, shapes, movement) with a live preview of four sample graphics. */
export function BrandKitPanel({ view }: { view: BrandKitView }) {
  const { kit, kits, projectChoice, appKitId, suggested } = view;
  const [draft, setDraft] = useState<BrandKit>(kit);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setDraft(kit); setMessage(null); }, [kit]);

  const theme = useMemo(() => themeOfKit(draft), [draft]);
  const changed = JSON.stringify(draft) !== JSON.stringify(kit);
  const builtin = isBuiltinKit(kit.id) || SUGGESTED_KITS.some((k) => k.id === kit.id);
  const select = projectChoice === "" ? "" : projectChoice;
  const appKit = kits.find((k) => k.id === appKitId);

  const save = (asCopy: boolean): void => {
    const input = asCopy || builtin ? { ...draft, id: `${draft.id}_copy`, name: asCopy && draft.name === kit.name ? `${draft.name} copy` : draft.name } : draft;
    const result = view.save(input);
    view.chooseForProject(result.kit.id);
    setMessage(result.notes.length > 0 ? `Saved. Fixed automatically: ${result.notes.join(" ")}` : "Saved.");
  };

  return (
    <details className="rounded-xl border border-line bg-surface-2 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Brand kit: {kit.name}</summary>
      <div className="mt-3 flex flex-col gap-4">
        <p className="text-xs text-muted">The look of every graphic in this project: colours, fonts, round corners, movement. Pick one of the ready-made kits, or change one and save it as your own.</p>

        <Field label="Kit for this project" htmlFor="kit-select">
          <Select id="kit-select" value={select} onChange={(e) => view.chooseForProject(e.target.value)}>
            <option value="">Same as the app ({appKit?.name ?? "Clean Documentary"})</option>
            <option value={MATCH_STYLE}>Match the visual style ({suggested.kit.name})</option>
            <optgroup label="Ready-made">
              {kits.filter((k) => isBuiltinKit(k.id)).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </optgroup>
            <optgroup label="Made for a visual style">
              {kits.filter((k) => SUGGESTED_KITS.some((s) => s.id === k.id)).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </optgroup>
            {kits.some((k) => view.isCustom(k.id)) && (
              <optgroup label="Mine">
                {kits.filter((k) => view.isCustom(k.id)).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
        {projectChoice === MATCH_STYLE && <p className="flex items-start gap-1.5 text-xs text-muted"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{suggested.kit.name}: {suggested.reason}.</p>}

        <KitSamples theme={theme} />
        <KitEditor kit={draft} onChange={setDraft} />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={Save} disabled={!changed && !builtin} onClick={() => save(false)}>{builtin ? "Save as my kit" : "Save"}</Button>
          {!builtin && <Button icon={Copy} onClick={() => save(true)}>Save as a copy</Button>}
          <Button icon={Globe} disabled={kit.id === appKitId} onClick={() => view.chooseForApp(kit.id)}>Use for all projects</Button>
          {changed && <Button onClick={() => setDraft(kit)}>Undo changes</Button>}
          {view.isCustom(kit.id) && <Button icon={Trash2} onClick={() => view.remove(kit.id)}>Delete this kit</Button>}
        </div>
        {message && <p className="text-xs text-muted" role="status">{message}</p>}
      </div>
    </details>
  );
}
