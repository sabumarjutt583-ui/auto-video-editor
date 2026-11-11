import { useState } from "react";
import type { SceneSettings, SceneTimingRange } from "../../types/project";
import type { TimedWord } from "../../lib/timing/types";
import { DEFAULT_TIMING_RANGES, validTimingRanges } from "../../lib/scenes/schedule";
import { buildBySeconds } from "../../lib/scenes/build";
import { Button, NumberField } from "../ui";

export function TimingRanges({ settings, onChange, busy = false, words = [], voiceDuration = 0 }: {
  settings: SceneSettings; onChange: (s: SceneSettings) => void; busy?: boolean;
  words?: readonly TimedWord[]; voiceDuration?: number;
}) {
  const [rows, setRows] = useState<SceneTimingRange[]>(() => validTimingRanges(settings.timingRanges).length ? settings.timingRanges! : DEFAULT_TIMING_RANGES.map((r) => ({ ...r })));
  const [preview, setPreview] = useState(false);
  const valid = validTimingRanges(rows).length > 0;
  const draft = { ...settings, mode: "seconds" as const, timingRanges: rows };
  const scenes = preview && valid && words.length ? buildBySeconds({ settings: draft, words, voiceDuration }) : [];
  const change = (i: number, patch: Partial<SceneTimingRange>) => { setPreview(false); setRows(rows.map((r, j) => i === j ? { ...r, ...patch } : r)); };
  return <details className="rounded-xl border border-line p-4" open={settings.timingRanges && settings.timingRanges.length > 0 ? true : undefined}>
    <summary className="cursor-pointer font-semibold">Custom timing ranges</summary>
    <p className="my-3 text-sm text-muted">Choose how often the picture changes in each part of the video. Times below are minutes. Each range ends where the next starts; the last continues to the end. Cuts use word boundaries and reuse existing voice timings.</p>
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => <div key={i} className="flex flex-wrap items-center gap-3">
        <label className="text-sm">From minute <NumberField id={`range-start-${i}`} value={r.startSeconds / 60} min={0} max={1440} step={0.5} disabled={busy || i === 0} onChange={(v) => change(i, { startSeconds: v * 60 })} /></label>
        <span className="text-sm text-muted">to {rows[i + 1] ? `${rows[i + 1].startSeconds / 60} min` : "end"}</span>
        <label className="text-sm">Every seconds <NumberField id={`range-target-${i}`} value={r.targetSeconds} min={1} max={60} step={0.5} disabled={busy} onChange={(v) => change(i, { targetSeconds: v })} /></label>
        {i > 0 && <Button disabled={busy} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setPreview(false); }}>Remove</Button>}
      </div>)}
      {!valid && <p role="alert" className="text-sm text-danger">Start at 0. Start times must increase without duplicates; scene lengths must be 1–60 seconds.</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy || rows.length >= 30} onClick={() => { setRows([...rows, { startSeconds: rows[rows.length - 1].startSeconds + 60, targetSeconds: 10 }]); setPreview(false); }}>Add range</Button>
        {words.length > 0 && <Button disabled={busy || !valid} onClick={() => setPreview(true)}>Preview scenes</Button>}
        <Button disabled={busy || !valid} onClick={() => onChange(draft)}>Apply timing ranges</Button>
        {!!settings.timingRanges?.length && <Button disabled={busy} onClick={() => onChange({ ...settings, timingRanges: [] })}>Use fixed scene length</Button>}
      </div>
      {preview && scenes.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border border-line p-3 text-sm"><p className="mb-3 font-semibold">{scenes.length} scenes / image prompts · {voiceDuration.toFixed(1)} seconds</p>{scenes.slice(0, 100).map((s) => <p key={s.id} className="mb-2"><span className="text-accent">{s.start.toFixed(1)}–{s.end.toFixed(1)}s</span> · {s.text}</p>)}{scenes.length > 100 && <p>First 100 scenes shown. Apply to inspect the full scene table.</p>}</div>}
      <p className="text-xs text-muted">Short scenes can merge according to the minimum scene length below. Applying to existing scenes may replace prompts and media links; project mode asks for confirmation when work exists.</p>
    </div>
  </details>;
}
