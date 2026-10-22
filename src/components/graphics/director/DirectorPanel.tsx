import { Loader2, Wand2 } from "lucide-react";

import { DENSITIES, type Density } from "../../../lib/graphics/brand";
import { requestCancel } from "../../../store/jobStore";
import type { Scene } from "../../../types";
import { ErrorNotice } from "../../ErrorNotice";
import { Button, SegmentedControl } from "../../ui";
import type { DirectorView } from "./useGraphicDirector";

const LABELS: Record<Density, string> = { low: "Few", normal: "Normal", high: "Many" };

/** "Generate graphics": the AI picks the moments and writes the graphics for the whole project or one scene. */
export function DirectorPanel({ view, scene }: { view: DirectorView; scene: Scene | undefined }) {
  const busy = view.job !== null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3" aria-label="Graphics director">
      <h4 className="text-sm font-semibold">Automatic graphics</h4>
      <p className="text-xs text-muted">The app finds numbers, places, names, lists and quotes in the narration. The AI decides which ones deserve a graphic and how it looks; the app draws it in your brand kit. Many scenes stay clean on purpose.</p>
      <SegmentedControl label="How many graphics" options={DENSITIES.map((d) => ({ value: d, label: LABELS[d] }))} value={view.density} onChange={view.setDensity} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Wand2} loading={busy} onClick={() => void view.generate()}>Generate graphics</Button>
        {scene && <Button disabled={busy} onClick={() => void view.generate(new Set([scene.id]))}>Only for {scene.id}</Button>}
        {busy && view.job && <Button onClick={() => requestCancel(view.job?.id ?? "")}>Cancel</Button>}
      </div>
      {view.job && (
        <div role="status" className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{view.job.stage}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round(view.job.percent)}%` }} /></div>
        </div>
      )}
      {view.cancelled && <p className="text-xs text-muted" role="status">Stopped. Graphics that were finished are kept.</p>}
      {view.summary && !busy && <p className="text-xs text-muted" role="status">{view.summary}</p>}
      {view.notes.length > 0 && !busy && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Placement: {view.notes.length} change{view.notes.length === 1 ? "" : "s"} to keep the picture and captions clear</summary>
          <ul className="mt-1 list-disc pl-4">{view.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </details>
      )}
      {view.error && <ErrorNotice error={view.error} />}
    </div>
  );
}
