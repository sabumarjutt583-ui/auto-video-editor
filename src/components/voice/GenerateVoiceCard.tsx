import { AudioLines, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { formatLength, scriptStats } from "../../lib/tts/estimate";
import { edgeLanguages, filterEdgeVoices } from "../../lib/tts/edge";
import { edgeVoices, ttsGenerate, ttsOptions, ttsPreview, ttsPreviewFull, type EdgeVoice, type TtsOptions } from "../../lib/tts/api";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { AppError, Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Field, Select, TextInput } from "../ui";
import { JobBar } from "./JobBar";

const SAMPLE_EN = "Hello. This is how I sound when I read your story out loud.";
const SAMPLE_KO = "안녕하세요. 지금부터 이 목소리로 이야기를 읽어 드리겠습니다.";
const HANGUL = /[가-힯]/u;

interface GenerateVoiceCardProps {
  project: Project;
  /** The voice is locked or something else is running. */
  disabled: boolean;
  /** Called with the path of the finished voice file; the Voice step imports it like an uploaded file. */
  onGenerated: (path: string) => Promise<void>;
}

/** Makes the voice-over from the script: Gemini's speech models (the Gemini
 * API key from Settings) or Microsoft Edge TTS (free and unofficial, no key,
 * called directly — never silently swapped for each other). */
export function GenerateVoiceCard({ project, disabled, onGenerated }: GenerateVoiceCardProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const job = useJobStore(selectJob(["tts"]));
  const [options, setOptions] = useState<TtsOptions | null>(null);
  const [edgeList, setEdgeList] = useState<EdgeVoice[] | null>(null);
  const [edgeLanguage, setEdgeLanguage] = useState("");
  const [script, setScript] = useState(project.script);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const samples = useRef(new Map<string, string>());

  useEffect(() => {
    let stale = false;
    ttsOptions()
      .then((loaded) => {
        if (!stale) setOptions(loaded);
      })
      .catch((caught: unknown) => {
        if (!stale) setError(toAppError(caught, "The voice list could not be loaded."));
      });
    return () => {
      stale = true;
    };
  }, []);

  const provider = settings?.ttsProvider ?? "gemini";
  const isEdge = provider === "edge";

  // The live Edge list is fetched only when Edge is chosen; the built-in
  // fallback list from ttsOptions covers the case where Microsoft is down.
  useEffect(() => {
    if (!isEdge || edgeList !== null) return;
    let stale = false;
    edgeVoices()
      .then((loaded) => {
        if (!stale) setEdgeList(loaded);
      })
      .catch(() => {
        if (!stale) setEdgeList(options?.edgeVoices ?? []);
      });
    return () => {
      stale = true;
    };
  }, [isEdge, edgeList, options]);

  const model = settings?.ttsModel || options?.defaultModel || "";
  const voice = isEdge
    ? settings?.ttsEdgeVoice || options?.edgeDefaultVoice || ""
    : settings?.ttsVoice || options?.defaultVoice || "";
  const style = settings?.ttsStyle ?? "";
  const rate = settings?.ttsRate ?? 0;
  const volume = settings?.ttsVolume ?? 0;
  const stats = useMemo(() => scriptStats(script), [script]);
  const busy = job !== null;
  const modelNote = options?.models.find((m) => m.id === model)?.note;
  const shownEdgeVoices = filterEdgeVoices(edgeList ?? options?.edgeVoices ?? [], edgeLanguage);
  const languages = edgeLanguages(edgeList ?? options?.edgeVoices ?? []);

  async function listen() {
    setError(null);
    const sample = script.trim() ? script.trim().split(/(?<=[.!?。！？])\s+/u)[0]?.slice(0, 200) ?? SAMPLE_EN : HANGUL.test(script) ? SAMPLE_KO : SAMPLE_EN;
    const key = `${provider}|${model}|${voice}|${style}|${rate}|${volume}|${sample}`;
    setListening(true);
    try {
      let address = samples.current.get(key);
      if (!address) {
        address = isEdge
          ? await ttsPreviewFull(voice, "", "", sample, "edge", rate, volume)
          : await ttsPreview(voice, model, style, sample);
        samples.current.set(key, address);
      }
      await new Audio(address).play();
    } catch (caught) {
      setError(toAppError(caught, "The voice sample could not be made."));
    } finally {
      setListening(false);
    }
  }

  async function generate() {
    setError(null);
    setNotice(null);
    try {
      const result = await runJob("tts", "Making the voice", (id) =>
        ttsGenerate(project.id, { text: script, voice, model, style, provider, rate, volume }, id),
      );
      await onGenerated(result.path);
      setNotice(`Voice made: ${formatLength(Math.round(result.duration))}, ${result.pieces} ${result.pieces === 1 ? "piece" : "pieces"}${result.reused > 0 ? ` (${result.reused} kept from the last try)` : ""}.`);
    } catch (caught) {
      if (isCancelled(caught)) setNotice("Cancelled. The pieces that were finished are kept.");
      else setError(toAppError(caught, "The voice could not be made."));
    }
  }

  return (
    <Card
      title={isEdge ? "Make the voice with Microsoft Edge TTS" : "Make the voice with Gemini"}
      description={
        isEdge
          ? "Paste your script, choose a Microsoft voice, and the app speaks it for you. Free and unofficial: no key, card, or account, and Microsoft may change or limit it. If Edge fails, switch back to Gemini by hand — the app never switches silently. You can still upload your own voice-over instead."
          : "Paste your script, choose a voice, and the app speaks it for you. Uses your Gemini API key. You can still upload your own voice-over instead."
      }
      icon={AudioLines}
    >
      {error && <ErrorNotice error={error} />}
      <Field label="Script" htmlFor="tts-script" hint={stats.words + stats.wideCharacters === 0 ? "Paste the exact words to be spoken." : `${stats.characters.toLocaleString()} characters · about ${formatLength(stats.seconds)} · made in ${stats.pieces} ${stats.pieces === 1 ? "piece" : "pieces"}`}>
        <textarea
          id="tts-script"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          disabled={disabled || busy}
          rows={8}
          placeholder="Paste the narration here (English, Korean...)"
          className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent disabled:opacity-50"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Voice provider" htmlFor="tts-provider" hint={isEdge ? "Edge is free and unofficial; no key is used." : "Gemini uses your Gemini API key from Settings."}>
          <Select
            id="tts-provider"
            value={provider}
            disabled={disabled || busy}
            onChange={(event) => updateSettings({ ttsProvider: event.target.value as "gemini" | "edge" })}
          >
            <option value="gemini">Google Gemini TTS</option>
            <option value="edge">Microsoft Edge TTS (free, unofficial)</option>
          </Select>
        </Field>
        {isEdge ? (
          <Field label="Language" htmlFor="tts-edge-language" hint="Narrows the Microsoft voice list.">
            <Select id="tts-edge-language" value={edgeLanguage} disabled={disabled || busy} onChange={(event) => setEdgeLanguage(event.target.value)}>
              <option value="">All languages</option>
              {languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Model" htmlFor="tts-model" hint={modelNote}>
            <Select id="tts-model" value={model} disabled={disabled || busy || !options} onChange={(event) => updateSettings({ ttsModel: event.target.value })}>
              {(options?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Voice" htmlFor="tts-voice" hint="Press Listen to hear the voice before you make the whole script.">
          <div className="flex gap-2">
            <Select
              id="tts-voice"
              value={voice}
              disabled={disabled || busy || !options}
              onChange={(event) => {
                if (isEdge) updateSettings({ ttsEdgeVoice: event.target.value });
                else updateSettings({ ttsVoice: event.target.value });
              }}
            >
              {isEdge
                ? shownEdgeVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} · {v.gender || "voice"}
                    </option>
                  ))
                : (options?.voices ?? []).map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} · {v.feel}
                    </option>
                  ))}
            </Select>
            <Button icon={Play} loading={listening} disabled={disabled || busy || !options} onClick={() => void listen()}>
              Listen
            </Button>
          </div>
        </Field>
        {isEdge ? (
          <Field label="Rate and volume" htmlFor="tts-rate" hint="Rate -50% to +100%, volume -100% to +100%. Pitch is not offered: the endpoint ignores it.">
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted" htmlFor="tts-rate">
                Rate {rate >= 0 ? `+${rate}%` : `${rate}%`}
              </label>
              <input
                id="tts-rate"
                type="range"
                min={-50}
                max={100}
                step={5}
                value={rate}
                disabled={disabled || busy}
                onChange={(event) => updateSettings({ ttsRate: Number(event.target.value) })}
                className="flex-1"
              />
              <label className="text-xs text-muted" htmlFor="tts-volume">
                Volume {volume >= 0 ? `+${volume}%` : `${volume}%`}
              </label>
              <input
                id="tts-volume"
                type="range"
                min={-100}
                max={100}
                step={5}
                value={volume}
                disabled={disabled || busy}
                onChange={(event) => updateSettings({ ttsVolume: Number(event.target.value) })}
                className="flex-1"
              />
            </div>
          </Field>
        ) : (
          <Field label="Style (optional)" htmlFor="tts-style" hint={'Say how it should sound, for example: "in a calm, warm storyteller voice". The app writes "Say …:" in front of your words.'}>
            <TextInput id="tts-style" value={style} maxLength={300} disabled={disabled || busy} placeholder="in a calm, warm storyteller voice" onChange={(event) => updateSettings({ ttsStyle: event.target.value })} />
          </Field>
        )}
      </div>
      {isEdge && (
        <p className="text-xs text-muted">
          Edge style notes are not used: Gemini&apos;s &ldquo;Say in a calm voice:&rdquo; prefix would be spoken aloud by Edge, so it is left out. Use rate and volume instead.
        </p>
      )}
      {job && <JobBar job={job} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {project.voiceOriginalPath && <span className="text-xs text-muted">This replaces the voice-over you have now.</span>}
        <Button variant="primary" icon={AudioLines} disabled={disabled || busy || script.trim() === "" || !options} onClick={() => void generate()}>
          Make voice
        </Button>
      </div>
    </Card>
  );
}
