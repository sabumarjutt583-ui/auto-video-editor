import { ArrowDown, ArrowUp, Music, Plus, Trash2 } from "lucide-react";

import type { DuckingPreset, MusicMode } from "../../types";
import { Button, Field, IconButton, SegmentedControl, Select } from "../ui";
import type { AudioView } from "./useAudio";

function Slider({ id, label, value, min, max, step, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return (
    <Field label={`${label}: ${value}${unit}`} htmlFor={id}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </Field>
  );
}

const DUCKING: { value: DuckingPreset; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "light", label: "Light" },
  { value: "normal", label: "Normal" },
  { value: "strong", label: "Strong" },
];

function seconds(value: number): string {
  const m = Math.floor(value / 60);
  return `${m}:${String(Math.round(value - m * 60)).padStart(2, "0")}`;
}

/** Music tracks, volume, fades and ducking. */
export function MusicSection({ view }: { view: AudioView }) {
  const { audio } = view;
  return (
    <section className="flex flex-col gap-3" aria-label="Music" data-testid="music-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Music size={16} aria-hidden /> Background music
        </h3>
        <Button icon={Plus} onClick={() => void view.addMusic()} disabled={view.job !== null} data-testid="add-music">
          Add music
        </Button>
      </div>
      {audio.tracks.length === 0 ? (
        <p className="text-xs text-muted">No music yet. Add one or more songs; they play in this order.</p>
      ) : (
        <ol className="flex flex-col gap-1.5" data-testid="music-list">
          {audio.tracks.map((track, i) => (
            <li key={track.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm">
              <span className="w-5 text-xs text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={track.name}>{track.name}</span>
              <span className="text-xs tabular-nums text-muted">{seconds(track.duration)}</span>
              <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => view.moveMusic(track.id, -1)} />
              <IconButton icon={ArrowDown} label="Move down" disabled={i === audio.tracks.length - 1} onClick={() => view.moveMusic(track.id, 1)} />
              <IconButton icon={Trash2} label="Remove track" danger onClick={() => view.deleteMusic(track.id)} />
            </li>
          ))}
        </ol>
      )}
      <Slider id="music-volume" label="Music volume" value={audio.musicVolume} min={0} max={100} step={1} unit="%" onChange={(musicVolume) => view.change({ musicVolume })} />
      <div className="grid grid-cols-2 gap-3">
        <Slider id="music-fade-in" label="Fade in" value={audio.fadeIn} min={0} max={10} step={0.5} unit=" s" onChange={(fadeIn) => view.change({ fadeIn })} />
        <Slider id="music-fade-out" label="Fade out" value={audio.fadeOut} min={0} max={10} step={0.5} unit=" s" onChange={(fadeOut) => view.change({ fadeOut })} />
      </div>
      <Field label="When the music is shorter than the video" htmlFor="music-mode">
        <Select id="music-mode" value={audio.mode} onChange={(e) => view.change({ mode: e.target.value as MusicMode })}>
          <option value="loop">Play the list again (loop)</option>
          <option value="fade">Play once, then fade out and stop</option>
        </Select>
      </Field>
      <Field label="Ducking" hint="Music gets quieter while the voice speaks and comes back in pauses.">
        <SegmentedControl<DuckingPreset> label="Ducking" value={audio.ducking} onChange={(ducking) => view.change({ ducking })} options={DUCKING} />
      </Field>
    </section>
  );
}
