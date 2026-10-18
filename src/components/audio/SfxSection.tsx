import { Play, Plus, RefreshCw, Trash2, Volume2 } from "lucide-react";

import { usePlaybackStore } from "../../store/playbackStore";
import type { SfxIntensity } from "../../types";
import { Button, Checkbox, Field, IconButton, SegmentedControl, Select } from "../ui";
import type { AudioView } from "./useAudio";
import { previewSound, type SfxLibraryView } from "./useSfxLibrary";

const INTENSITY: { value: SfxIntensity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

function label(sounds: SfxLibraryView["sounds"], id: string): string {
  const sound = sounds.find((s) => s.id === id);
  return sound ? `${sound.category} · ${sound.id.replace(/_/g, " ")}` : `${id} (missing)`;
}

/** Automatic sound effects, the list of cues and "add from library". */
export function SfxSection({ view, library, duration }: { view: AudioView; library: SfxLibraryView; duration: number }) {
  const { audio, cues } = view;
  const selected = cues.find((c) => c.id === view.selectedCue) ?? null;
  const sounds = library.sounds;
  const add = (soundId: string) => view.addCue(soundId, usePlaybackStore.getState().time);

  return (
    <section className="flex flex-col gap-3" aria-label="Sound effects" data-testid="sfx-section">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Volume2 size={16} aria-hidden /> Sound effects
      </h3>
      {library.error && <p className="text-xs text-danger">{library.error.message}</p>}
      {library.warnings.map((w) => (
        <p key={w} className="text-xs text-muted">{w}</p>
      ))}
      <Checkbox label="Add sound effects automatically" checked={audio.autoSfx} onChange={(e) => view.change({ autoSfx: e.target.checked })} />
      <Field label="How many effects">
        <SegmentedControl<SfxIntensity> label="Effect intensity" value={audio.intensity} onChange={(intensity) => view.change({ intensity })} options={INTENSITY} />
      </Field>
      <Field label={`Effects volume: ${audio.sfxVolume}%`} htmlFor="sfx-volume">
        <input id="sfx-volume" type="range" min={0} max={100} step={1} value={audio.sfxVolume} onChange={(e) => view.change({ sfxVolume: Number(e.target.value) })} className="accent-[var(--accent)]" />
      </Field>
      {view.edited && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs">
          <span>You changed the effects by hand.</span>
          <Button icon={RefreshCw} onClick={view.planAgain} data-testid="plan-again">Plan again</Button>
        </div>
      )}
      {cues.length === 0 ? (
        <p className="text-xs text-muted">{audio.autoSfx || view.edited ? "No effects for these settings." : "Automatic effects are off."} You can add one below.</p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto" data-testid="cue-list">
          {cues.map((cue) => (
            <li key={cue.id}>
              <button
                type="button"
                onClick={() => view.selectCue(cue.id === view.selectedCue ? null : cue.id)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 text-left text-xs ${cue.id === view.selectedCue ? "border-accent bg-accent-soft" : "border-line bg-surface-2"}`}
              >
                <span className="w-12 tabular-nums text-muted">{cue.time.toFixed(1)} s</span>
                <span className="min-w-0 flex-1 truncate">{label(sounds, cue.soundId)}</span>
                <span className="text-muted">{cue.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3" data-testid="cue-editor">
          <Field label="Sound" htmlFor="cue-sound">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select id="cue-sound" value={selected.soundId} onChange={(e) => view.editCue(selected.id, { soundId: e.target.value })}>
                  {!sounds.some((s) => s.id === selected.soundId) && <option value={selected.soundId}>{selected.soundId} (missing)</option>}
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>{label(sounds, s.id)}</option>
                  ))}
                </Select>
              </div>
              <IconButton icon={Play} label="Listen" onClick={() => { const s = sounds.find((x) => x.id === selected.soundId); if (s) previewSound(library.urlOf(s.file), selected.gain); }} />
            </div>
          </Field>
          <Field label={`Time: ${selected.time.toFixed(1)} s`} htmlFor="cue-time">
            <input id="cue-time" type="range" min={0} max={Math.max(1, Math.floor(duration))} step={0.1} value={selected.time} onChange={(e) => view.editCue(selected.id, { time: Number(e.target.value) })} className="accent-[var(--accent)]" />
          </Field>
          <Field label={`Loudness: ${Math.round(selected.gain * 100)}%`} htmlFor="cue-gain">
            <input id="cue-gain" type="range" min={0} max={100} step={1} value={Math.round(selected.gain * 100)} onChange={(e) => view.editCue(selected.id, { gain: Number(e.target.value) / 100 })} className="accent-[var(--accent)]" />
          </Field>
          <Button variant="danger" icon={Trash2} onClick={() => view.deleteCue(selected.id)} data-testid="delete-cue">Delete this effect</Button>
        </div>
      )}
      <Field label="Add from the library at the playhead" htmlFor="cue-add">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select id="cue-add" value="" onChange={(e) => { if (e.target.value) add(e.target.value); }} disabled={sounds.length === 0}>
              <option value="">Choose a sound…</option>
              {sounds.map((s) => (
                <option key={s.id} value={s.id}>{label(sounds, s.id)}</option>
              ))}
            </Select>
          </div>
          <Plus size={16} aria-hidden className="text-muted" />
        </div>
      </Field>
    </section>
  );
}
