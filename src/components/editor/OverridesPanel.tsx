import { Field, Select, Checkbox } from "../ui";
import { DEFAULT_OVERRIDE } from "../../lib/editor/model";
import type { KenBurns, SceneOverride, Transition, VideoFit } from "../../types";

const MOTIONS: [KenBurns, string][] = [
  ["auto", "Automatic"],
  ["zoom_in", "Zoom in"],
  ["zoom_out", "Zoom out"],
  ["pan_left", "Pan left"],
  ["pan_right", "Pan right"],
  ["pan_up", "Pan up"],
  ["none", "No motion"],
];
const TRANSITIONS: [Transition, string][] = [
  ["auto", "Automatic"],
  ["cut", "Cut"],
  ["fade", "Fade"],
  ["dissolve", "Dissolve"],
  ["slide", "Slide"],
  ["zoom", "Zoom"],
  ["whip", "Whip"],
];

interface OverridesPanelProps {
  sceneId: string;
  value: SceneOverride;
  isVideo: boolean;
  isFirst: boolean;
  onChange: (patch: Partial<SceneOverride>) => void;
  onReset: () => void;
}

/** The choices for one scene that differ from the automatic ones. */
export function OverridesPanel({ sceneId, value, isVideo, isFirst, onChange, onReset }: OverridesPanelProps) {
  const changed = JSON.stringify(value) !== JSON.stringify(DEFAULT_OVERRIDE);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label={`Settings for ${sceneId}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scene {sceneId}</h3>
        <button type="button" className="cursor-pointer text-xs text-accent-fg hover:underline disabled:cursor-default disabled:opacity-40 disabled:no-underline" disabled={!changed} onClick={onReset}>
          Back to automatic
        </button>
      </div>
      <Field label="Motion" htmlFor="ov-motion">
        <Select id="ov-motion" value={value.kenBurns} onChange={(e) => onChange({ kenBurns: e.target.value as KenBurns })}>
          {MOTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label={isFirst ? "Transition into this scene (the first scene has none)" : "Transition into this scene"} htmlFor="ov-transition">
        <Select id="ov-transition" disabled={isFirst} value={value.transition} onChange={(e) => onChange({ transition: e.target.value as Transition })}>
          {TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      {isVideo && (
        <>
          <Field label="Clip that does not match the frame" htmlFor="ov-fit">
            <Select id="ov-fit" value={value.videoFit} onChange={(e) => onChange({ videoFit: e.target.value as VideoFit })}>
              <option value="crop">Crop to fill</option>
              <option value="blur">Blurred background</option>
            </Select>
          </Field>
          <Field label={`Speed when the clip is shorter than the scene: ${Math.round(value.speed * 100)}%`} htmlFor="ov-speed">
            <input id="ov-speed" type="range" min={25} max={100} step={5} value={Math.round(value.speed * 100)} onChange={(e) => onChange({ speed: Number(e.target.value) / 100 })} className="accent-[var(--accent)]" />
          </Field>
        </>
      )}
      <Checkbox label="Important moment (used for sound effects)" checked={value.emphasis} onChange={(e) => onChange({ emphasis: e.target.checked })} />
    </section>
  );
}
