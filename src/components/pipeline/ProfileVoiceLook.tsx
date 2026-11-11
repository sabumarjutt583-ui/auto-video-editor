import { useEffect, useMemo, useState } from "react";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import { captureProviders } from "../../lib/pipeline/providers";
import { ttsOptions, edgeVoices, ttsPreviewFull, type EdgeVoice, type TtsOptions } from "../../lib/tts/api";
import { edgeLanguages, filterEdgeVoices } from "../../lib/tts/edge";
import { localeLabel, microsoftVoiceLabel } from "../../lib/tts/voiceLabels";
import { useSettingsStore } from "../../store/settingsStore";
import { useVoiceFavoritesStore } from "../../store/voiceFavoritesStore";
import { useStyleStore } from "../../store/styleStore";
import type { DetailLevel } from "../../types/project";
import { Button, Card, Checkbox, Field, NumberField, SegmentedControl, Select, TextInput } from "../ui";

interface Props { profile: ChannelProfile; onChange: (profile: ChannelProfile) => void }

export function ProfileVoiceLook({ profile, onChange }: Props) {
  const [options, setOptions] = useState<TtsOptions | null>(null);
  const [edgeList, setEdgeList] = useState<EdgeVoice[] | null>(null);
  const [language, setLanguage] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const settings = useSettingsStore(s => s.settings);
  const favorites = useVoiceFavoritesStore();
  const styles = useStyleStore(s => s.styles);
  const loaded = useStyleStore(s => s.loaded);
  useEffect(() => {
    let stale = false;
    ttsOptions().then(v => { if (!stale) setOptions(v); }).catch(() => { if (!stale) setError("The voice list could not be loaded. Reopen channel settings to try again."); });
    return () => { stale = true; };
  }, []);
  useEffect(() => { if (!loaded) void useStyleStore.getState().load(); }, [loaded]);
  const { voice, look } = profile;
  const resolved = settings && options ? captureProviders(settings, profile, options).voice : null;
  const provider = resolved?.provider || voice.provider || "gemini";
  const isEdge = provider === "edge";
  useEffect(() => {
    if (!isEdge) return;
    let stale = false;
    edgeVoices().then(v => { if (!stale) setEdgeList(v); }).catch(() => undefined);
    return () => { stale = true; };
  }, [isEdge]);
  const groups = useMemo(() => {
    const map = new Map<string, typeof styles>();
    for (const style of styles) map.set(style.category, [...(map.get(style.category) ?? []), style]);
    return [...map.entries()];
  }, [styles]);
  const allEdge = edgeList ?? options?.edgeVoices ?? [];
  const favoriteNames = favorites[isEdge ? "edge" : "gemini"];
  const selected = isEdge ? voice.edgeVoice || (/Neural$/.test(voice.voice) ? voice.voice : "") : (/Neural$/.test(voice.voice) ? "" : voice.voice);
  const choices = (isEdge ? filterEdgeVoices(allEdge, language) : options?.voices ?? [])
    .filter(v => !onlyFavorites || favoriteNames.includes(v.name)).slice()
    .sort((a,b) => Number(favoriteNames.includes(b.name)) - Number(favoriteNames.includes(a.name)) || a.name.localeCompare(b.name));
  const setVoice = (patch: Partial<ChannelProfile["voice"]>) => onChange({ ...profile, voice: { ...voice, ...patch } });
  async function listen() {
    if (!resolved) return;
    setListening(true); setError("");
    let address = "";
    try {
      address = await ttsPreviewFull(resolved.voice, resolved.model, resolved.style,
        profile.language === "ko" ? "안녕하세요. 이 목소리로 이야기를 읽어 드리겠습니다." : "Hello. This is a short sample of your channel voice.",
        resolved.provider, resolved.rate, resolved.volume);
      const audio = new Audio(address);
      await new Promise<void>((resolve, reject) => { audio.onended = () => resolve(); audio.onerror = () => reject(new Error("The sample could not play.")); audio.play().catch(reject); });
    } catch (e) { setError(e instanceof Error ? e.message : "The sample failed."); }
    finally { if (address) URL.revokeObjectURL(address); setListening(false); }
  }
  return <>
    <Card title="Voice" description="Saved for this channel. Your own uploaded voice file is used instead when provided.">
      <Field label="Voice provider" htmlFor="p-provider" hint="Choose Microsoft or Gemini for this channel. Automatic keeps an existing channel voice; otherwise it follows Settings.">
        <Select id="p-provider" value={voice.provider ?? ""} onChange={e => setVoice({ provider: e.target.value as "" | "edge" | "gemini" })}>
          <option value="">Automatic / saved channel voice</option>
          <option value="edge">Microsoft Edge TTS (free)</option>
          <option value="gemini">Gemini</option>
        </Select>
      </Field>
      <p className="text-xs text-muted">Using {isEdge ? "Microsoft Edge TTS" : "Gemini"}: {resolved ? (isEdge ? microsoftVoiceLabel(resolved.voice) : resolved.voice) : "Loading..."}</p>
      {isEdge && <Field label="Language and country" htmlFor="p-edge-language">
        <Select id="p-edge-language" value={language} onChange={e => setLanguage(e.target.value)}>
          <option value="">All languages</option>
          {edgeLanguages(allEdge).sort((a,b) => localeLabel(a).localeCompare(localeLabel(b))).map(code => <option key={code} value={code}>{localeLabel(code)}</option>)}
        </Select>
      </Field>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Voice" htmlFor="p-voice" hint="Settings default uses the default voice for this provider.">
          <Select id="p-voice" value={selected} onChange={e => setVoice({ ...(isEdge ? { edgeVoice: e.target.value } : { voice: e.target.value }), provider: isEdge ? "edge" : "gemini" })}>
            <option value="">Settings default</option>
            {selected && !choices.some(v => v.name === selected) && <option value={selected}>{isEdge ? microsoftVoiceLabel(selected) : selected} (saved selection)</option>}
            {choices.map(v => <option key={v.name} value={v.name}>{favoriteNames.includes(v.name) ? "★ " : ""}{isEdge ? microsoftVoiceLabel(v.name) : v.name}</option>)}
          </Select>
        </Field>
        {!isEdge && <Field label="Speech model" htmlFor="p-model">
          <Select id="p-model" value={voice.model} onChange={e => setVoice({ model: e.target.value })}>
            <option value="">Settings default</option>
            {(options?.models ?? []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>}
      </div>
      <div className="flex gap-3">
        <Button disabled={!resolved} onClick={() => resolved && favorites.toggle(isEdge ? "edge" : "gemini", resolved.voice)}>{resolved && favoriteNames.includes(resolved.voice) ? "★ Favourite" : "☆ Favourite"}</Button>
        <Button disabled={!resolved || listening} onClick={() => void listen()}>{listening ? "Playing..." : "Listen"}</Button>
      </div>
      <Checkbox label="Show favourites only" checked={onlyFavorites} onChange={e => setOnlyFavorites(e.target.checked)} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {isEdge ? <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Speaking speed (%)" htmlFor="p-rate" hint="-50 to 100."><NumberField id="p-rate" value={voice.rate ?? settings?.ttsRate ?? 0} min={-50} max={100} onChange={rate => setVoice({ rate })} /></Field>
        <Field label="Volume (%)" htmlFor="p-volume" hint="-100 to 100."><NumberField id="p-volume" value={voice.volume ?? settings?.ttsVolume ?? 0} min={-100} max={100} onChange={volume => setVoice({ volume })} /></Field>
      </div> : <Field label="How it should sound" htmlFor="p-vstyle" hint="Empty uses Settings.">
        <TextInput id="p-vstyle" value={voice.style} maxLength={300} onChange={e => setVoice({ style: e.target.value })} />
      </Field>}
      <Checkbox label="Cut the long silences out of the voice" checked={voice.cutSilence} onChange={e => setVoice({ cutSilence: e.target.checked })} />
    </Card>
    <Card title="Pictures" description="The look of every picture of this channel.">
      <Field label="Picture style" htmlFor="p-style" hint="Choose one before the first video. Preview styles in Prompt Generator.">
        <Select id="p-style" value={look.styleId} onChange={e => onChange({ ...profile, look: { ...look, styleId: e.target.value } })}>
          <option value="">Choose a style...</option>
          {groups.map(([category,list]) => <optgroup key={category} label={category}>{list.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</optgroup>)}
        </Select>
      </Field>
      <Field label="Prompt detail"><SegmentedControl<DetailLevel> label="Prompt detail" value={look.detail} onChange={detail => onChange({ ...profile, look: { ...look, detail } })} options={[{value:"short",label:"Short"},{value:"medium",label:"Medium"},{value:"detailed",label:"Detailed"}]} /></Field>
      <p className="text-xs text-muted">Pictures use your Google accounts from Settings. Scene videos are not part of this one-click path yet.</p>
    </Card>
  </>;
}
