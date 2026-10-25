import { useEffect, useMemo, useState } from "react";

import type { ChannelProfile } from "../../lib/pipeline/profile";
import { ttsOptions, type TtsOptions } from "../../lib/tts/api";
import { useStyleStore } from "../../store/styleStore";
import type { DetailLevel } from "../../types/project";
import { Card, Checkbox, Field, SegmentedControl, Select, TextInput } from "../ui";

interface Props {
  profile: ChannelProfile;
  onChange: (profile: ChannelProfile) => void;
}

/** The voice (Gemini speech) and the picture style of the channel. */
export function ProfileVoiceLook({ profile, onChange }: Props) {
  const [options, setOptions] = useState<TtsOptions | null>(null);
  const styles = useStyleStore((state) => state.styles);
  const loaded = useStyleStore((state) => state.loaded);

  useEffect(() => {
    let stale = false;
    ttsOptions()
      .then((loadedOptions) => {
        if (!stale) setOptions(loadedOptions);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, []);
  useEffect(() => {
    if (!loaded) void useStyleStore.getState().load();
  }, [loaded]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof styles>();
    for (const style of styles) map.set(style.category, [...(map.get(style.category) ?? []), style]);
    return [...map.entries()];
  }, [styles]);

  const { voice, look } = profile;
  return (
    <>
      <Card title="Voice" description="Used when the video starts from a script. If you give your own voice file for a video, that file is used instead.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voice" htmlFor="p-voice" hint="Empty = the voice chosen in Settings.">
            <Select id="p-voice" value={voice.voice} onChange={(e) => onChange({ ...profile, voice: { ...voice, voice: e.target.value } })}>
              <option value="">Settings default</option>
              {(options?.voices ?? []).map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.feel})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Speech model" htmlFor="p-model">
            <Select id="p-model" value={voice.model} onChange={(e) => onChange({ ...profile, voice: { ...voice, model: e.target.value } })}>
              <option value="">Settings default</option>
              {(options?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="How it should sound" htmlFor="p-vstyle" hint='For example "slow, warm, a little sad". Empty = no note.'>
          <TextInput id="p-vstyle" value={voice.style} maxLength={300} onChange={(e) => onChange({ ...profile, voice: { ...voice, style: e.target.value } })} />
        </Field>
        <Checkbox label="Cut the long silences out of the voice" checked={voice.cutSilence} onChange={(e) => onChange({ ...profile, voice: { ...voice, cutSilence: e.target.checked } })} />
      </Card>

      <Card title="Pictures" description="The look of every picture of this channel.">
        <Field label="Picture style" htmlFor="p-style" hint="Choose one before the first video. You can see all styles with their pictures in the Prompt Generator.">
          <Select id="p-style" value={look.styleId} onChange={(e) => onChange({ ...profile, look: { ...look, styleId: e.target.value } })}>
            <option value="">Choose a style…</option>
            {groups.map(([category, list]) => (
              <optgroup key={category} label={category}>
                {list.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Prompt detail">
          <SegmentedControl<DetailLevel>
            label="Prompt detail"
            value={look.detail}
            onChange={(detail) => onChange({ ...profile, look: { ...look, detail } })}
            options={[
              { value: "short", label: "Short" },
              { value: "medium", label: "Medium" },
              { value: "detailed", label: "Detailed" },
            ]}
          />
        </Field>
        <p className="text-xs text-muted">Pictures are made with your Google accounts (Settings). Videos for scenes come in a later update.</p>
      </Card>
    </>
  );
}
