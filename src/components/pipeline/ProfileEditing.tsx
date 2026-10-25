import { Music, Trash2 } from "lucide-react";

import { pickMusicFiles } from "../../lib/dialog";
import { PRESETS } from "../../lib/captions/presets";
import { MAX_MUSIC_FILES, type ChannelProfile } from "../../lib/pipeline/profile";
import type { CaptionPreset, DuckingPreset, RenderFps, SfxIntensity, ShortClipMode, TransitionMode } from "../../types/editor";
import { Button, Card, Checkbox, Field, IconButton, NumberField, Select } from "../ui";

interface Props {
  profile: ChannelProfile;
  onChange: (profile: ChannelProfile) => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Captions, music and sounds, and how the final video is put together. */
export function ProfileEditing({ profile, onChange }: Props) {
  const { captions, audio, render } = profile;

  async function addMusic() {
    const picked = await pickMusicFiles("Choose the channel's music");
    if (picked.length === 0) return;
    const merged = [...new Set([...audio.musicPaths, ...picked])].slice(0, MAX_MUSIC_FILES);
    onChange({ ...profile, audio: { ...audio, musicPaths: merged } });
  }

  return (
    <>
      <Card title="Captions" description="The words on screen, timed to the voice.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Look" htmlFor="p-cap">
            <Select id="p-cap" value={captions.preset} onChange={(e) => onChange({ ...profile, captions: { ...captions, preset: e.target.value as CaptionPreset } })}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Text colour" htmlFor="p-cap1">
            <input id="p-cap1" type="color" value={captions.primary} onChange={(e) => onChange({ ...profile, captions: { ...captions, primary: e.target.value.toUpperCase() } })} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface-2" />
          </Field>
          <Field label="Highlight colour" htmlFor="p-cap2">
            <input id="p-cap2" type="color" value={captions.highlight} onChange={(e) => onChange({ ...profile, captions: { ...captions, highlight: e.target.value.toUpperCase() } })} className="h-10 w-full cursor-pointer rounded-lg border border-line bg-surface-2" />
          </Field>
        </div>
        <Checkbox label="Capital letters (where the language has them)" checked={captions.uppercase} onChange={(e) => onChange({ ...profile, captions: { ...captions, uppercase: e.target.checked } })} />
      </Card>

      <Card title="Music and sounds" description="Music is copied into every new video. It gets quieter while the voice speaks.">
        {audio.musicPaths.length === 0 ? (
          <p className="text-sm text-muted">No music yet. Videos will have the voice and sound effects only.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {audio.musicPaths.map((path) => (
              <li key={path} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                <span className="truncate" title={path}>
                  {baseName(path)}
                </span>
                <IconButton icon={Trash2} label={`Remove ${baseName(path)}`} onClick={() => onChange({ ...profile, audio: { ...audio, musicPaths: audio.musicPaths.filter((p) => p !== path) } })} />
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button icon={Music} onClick={() => void addMusic()} disabled={audio.musicPaths.length >= MAX_MUSIC_FILES}>
            Add music
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Music volume (%)" htmlFor="p-mv">
            <NumberField id="p-mv" value={audio.musicVolume} min={0} max={100} onChange={(musicVolume) => onChange({ ...profile, audio: { ...audio, musicVolume } })} />
          </Field>
          <Field label="Quieter under the voice" htmlFor="p-duck">
            <Select id="p-duck" value={audio.ducking} onChange={(e) => onChange({ ...profile, audio: { ...audio, ducking: e.target.value as DuckingPreset } })}>
              <option value="off">Off</option>
              <option value="light">Light</option>
              <option value="normal">Normal</option>
              <option value="strong">Strong</option>
            </Select>
          </Field>
          <Field label="Sound effects" htmlFor="p-sfx">
            <Select id="p-sfx" value={audio.autoSfx ? audio.intensity : "off"} onChange={(e) => (e.target.value === "off" ? onChange({ ...profile, audio: { ...audio, autoSfx: false } }) : onChange({ ...profile, audio: { ...audio, autoSfx: true, intensity: e.target.value as SfxIntensity } }))}>
              <option value="off">Off</option>
              <option value="low">A few</option>
              <option value="normal">Normal</option>
              <option value="high">Many</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Final video" description="How the pictures move and join.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Transitions" htmlFor="p-tr">
            <Select id="p-tr" value={render.transitions} onChange={(e) => onChange({ ...profile, render: { ...render, transitions: e.target.value as TransitionMode } })}>
              <option value="cut">Cuts only</option>
              <option value="fade">Fades</option>
              <option value="mixed">Mixed (mostly cuts)</option>
            </Select>
          </Field>
          <Field label="Frames per second" htmlFor="p-fps">
            <Select id="p-fps" value={String(render.fps)} onChange={(e) => onChange({ ...profile, render: { ...render, fps: Number(e.target.value) as RenderFps } })}>
              <option value="24">24</option>
              <option value="30">30</option>
              <option value="60">60</option>
            </Select>
          </Field>
          <Field label="Short video clips" htmlFor="p-short" hint="A clip that is too long is cut at the end of the scene.">
            <Select id="p-short" value={render.shortClip} onChange={(e) => onChange({ ...profile, render: { ...render, shortClip: e.target.value as ShortClipMode } })}>
              <option value="smart">Slow down a little, then repeat</option>
              <option value="loop">Repeat from the start</option>
              <option value="hold">Hold the last picture</option>
            </Select>
          </Field>
        </div>
        <Checkbox label="Slow zoom and pan on the pictures (Ken Burns)" checked={render.kenBurns} onChange={(e) => onChange({ ...profile, render: { ...render, kenBurns: e.target.checked } })} />
      </Card>
    </>
  );
}
