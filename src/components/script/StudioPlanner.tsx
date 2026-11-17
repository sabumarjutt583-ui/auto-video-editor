import { useEffect, useState } from "react";
import { Button } from "../ui";
import {
  getStudioPlan, listStudioPlans, parseStudioError, previewStudioPlan,
  saveStudioPlan, studioPlanId,
} from "../../lib/script/studio/api.ts";
import type {
  ChannelStudioConfigV1, LegacyChannelSeed, ScriptMode, PlanInput, PartRequest,
  ScriptStudioPlanV1, StudioPreview, StudioPlanList,
} from "../../lib/script/studio/types.ts";

interface Props {
  config: ChannelStudioConfigV1;
  seed: LegacyChannelSeed;
  hasUnsavedSettings: boolean;
}
const cn = "w-full rounded border border-line bg-surface p-2 text-sm";
const emptyList: StudioPlanList = {plans: [], issues: []};
function message(error: unknown): string {
  const parsed = parseStudioError(error);
  return parsed ? parsed.code + ": " + parsed.message : "Local plan operation failed; no provider request was made.";
}
export function StudioPlanner({config,seed,hasUnsavedSettings}: Props) {
  const [title,setTitle] = useState("");
  const [topic,setTopic] = useState("");
  const [language,setLanguage] = useState("");
  const [mode,setMode] = useState<ScriptMode>(config.planning.defaultScriptMode);
  const [words,setWords] = useState(config.planning.defaultTotalWords);
  const [useStructuredDefaults,setUseStructuredDefaults] = useState(true);
  const [parts,setParts] = useState(config.planning.defaultPartCount);
  const [outline,setOutline] = useState(config.planning.outlineRequired);
  const [continuity,setContinuity] = useState(config.planning.continuityRequired);
  const [partInstructions,setPartInstructions] = useState<PartRequest[]>([]);
  const [planId,setPlanId] = useState(() => studioPlanId());
  const [preview,setPreview] = useState<StudioPreview | null>(null);
  const [saved,setSaved] = useState<ScriptStudioPlanV1 | null>(null);
  const [history,setHistory] = useState<StudioPlanList>(emptyList);
  const [error,setError] = useState("");
  const [messageText,setMessageText] = useState("");
  const [busy,setBusy] = useState(false);
  const partCount = mode === "single" ? 1 : parts;

  useEffect(() => {
    setMode(config.planning.defaultScriptMode);
    setWords(config.planning.defaultTotalWords);
    setParts(config.planning.defaultPartCount);
    setOutline(config.planning.outlineRequired);
    setContinuity(config.planning.continuityRequired);
    setLanguage("");
    setPartInstructions([]);
    setUseStructuredDefaults(true);
    setPreview(null);
    setPlanId(studioPlanId());
  }, [config.channelId,config.revision]);
  useEffect(() => {
    let live = true;
    setHistory(emptyList);setSaved(null);
    void listStudioPlans(config.channelId).then(value => {if(live)setHistory(value);})
      .catch(caught => {if(live)setError(message(caught));});
    return () => {live=false;};
  }, [config.channelId,config.revision]);
  useEffect(() => {
    setPreview(null);setMessageText("");
  }, [title,topic,language,mode,words,parts,outline,continuity,partInstructions,useStructuredDefaults,hasUnsavedSettings]);

  function editPart(index: number, field: keyof PartRequest, value: string): void {
    setPartInstructions(previous => {
      const next = Array.from({length:partCount},(_,i) => previous[i] ??
        {title:"",objective:"",overrideWords:null});
      next[index] = {
        ...next[index]!, [field]: field === "overrideWords"
          ? value.trim() === "" ? null : Number(value)
          : value,
      };
      return next;
    });
  }
  function input(): PlanInput {
    return {
      planId, channelId:config.channelId, expectedConfigRevision:config.revision,
      title,topic,language:language || null,mode:useStructuredDefaults ? null : mode,
      totalWords:useStructuredDefaults ? null : words,
      partCount:useStructuredDefaults ? null : mode === "single" ? 1 : parts,
      outlineRequired:outline,continuityRequired:continuity,
      parts:partInstructions.slice(0,partCount),
    };
  }
  async function act<T>(run: () => Promise<T>, onDone: (result:T) => void) {
    if(busy) return;
    setBusy(true);setError("");setMessageText("");
    try{onDone(await run());}
    catch(caught){setError(message(caught));}
    finally{setBusy(false);}
  }
  async function compareLocal() {
    if(hasUnsavedSettings){setError("Save channel Studio settings first. Preview uses only committed configuration.");return;}
    await act(() => previewStudioPlan(seed,input()), result => {
      setPreview(result);
      setMessageText("Offline preview prepared. Nothing was sent, copied or generated.");
    });
  }
  async function persistPlan() {
    if(hasUnsavedSettings){setError("Save Studio settings first.");return;}
    if(!preview){setError("Preview this exact plan first, then save.");return;}
    await act(() => saveStudioPlan(seed,input()), result => {
      setSaved(result);
      setHistory(prev => ({...prev,plans: [
        ...prev.plans.filter(p => p.planId !== result.planId),result,
      ]}));
      setMessageText("Immutable plan saved locally. No AI parts were generated.");
    });
  }
  async function reopen(id:string){
    await act(() => getStudioPlan(config.channelId,id), result => {
      setSaved(result);
      setMessageText("Reopened original immutable plan and configuration snapshot.");
    });
  }
  return (
    <section className="space-y-3 rounded border border-line p-3" aria-label="Offline single or multi-part Script Studio planner">
      <h4 className="font-semibold">Single / Multi-Part Script Planner — Offline Only</h4>
      <p className="text-xs text-muted">Draft plan only. The app calculates requested part targets; it never generates script text or calls a provider.</p>
      {hasUnsavedSettings && <p role="alert" className="text-xs text-danger">
        Current Studio changes are unsaved. Save them before planning so the immutable snapshot is accurate.
      </p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {messageText && <p role="status" className="text-xs text-muted">{messageText}</p>}
      <label className="block text-xs">Video title
        <input className={cn} maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/>
      </label>
      <label className="block text-xs">Video topic
        <textarea className={cn} maxLength={2000} rows={2} value={topic} onChange={e => setTopic(e.target.value)}/>
      </label>
      <label className="block text-xs">Narration language override (optional)
        <input className={cn} maxLength={120} value={language}
          onChange={e => setLanguage(e.target.value)} placeholder={config.writing.language || "Channel default"}/>
      </label>
      <label className="flex gap-2 text-xs">
        <input type="checkbox" checked={useStructuredDefaults}
          onChange={e => setUseStructuredDefaults(e.target.checked)}/>
        Resolve mode, total words and part count from selected Skill/prompt structured defaults
        (otherwise use these explicit job override fields)
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">Script mode
          <select className={cn} value={mode} onChange={e => {setMode(e.target.value as ScriptMode);setUseStructuredDefaults(false);}}>
            <option value="single">One complete script</option>
            <option value="multi_part">Multi-part</option>
          </select>
        </label>
        <label className="block text-xs">Total target words
          <input className={cn} type="number" min={50} max={200000}
            value={words} onChange={e => {setWords(Number(e.target.value));setUseStructuredDefaults(false);}}/>
        </label>
        {mode === "multi_part" && <label className="block text-xs">Number of parts (1–40)
          <input className={cn} type="number" min={1} max={40}
            value={parts} onChange={e => {setParts(Number(e.target.value));setUseStructuredDefaults(false);}}/>
        </label>}
      </div>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={outline}
        onChange={e => setOutline(e.target.checked)}/> Require outline</label>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={continuity}
        onChange={e => setContinuity(e.target.checked)}/> Require continuity notes</label>
      {Number.isSafeInteger(partCount) && partCount >= 1 && partCount <= 40 && (
        <details className="rounded border border-line p-2">
          <summary className="cursor-pointer text-xs font-semibold">Optional per-part titles, objectives and exact targets</summary>
          <p className="text-xs text-muted">Leave all word overrides empty for deterministic remainder distribution.
            If you override words, specify every part and make the totals add up exactly.</p>
          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {Array.from({length:partCount},(_,index) => (
              <div key={index} className="rounded border border-line p-2">
                <p className="text-xs font-medium">Part {index+1}</p>
                <input aria-label={"Part "+(index+1)+" title"} className={cn}
                  value={partInstructions[index]?.title ?? ""} maxLength={200}
                  onChange={e => editPart(index,"title",e.target.value)} placeholder="Optional part title"/>
                <textarea aria-label={"Part "+(index+1)+" objective"} className={cn}
                  value={partInstructions[index]?.objective ?? ""} maxLength={2000}
                  onChange={e => editPart(index,"objective",e.target.value)} placeholder="Optional objective"/>
                <input aria-label={"Part "+(index+1)+" word override"} className={cn} type="number"
                  min={50} max={200000} placeholder="Auto-distribute"
                  value={partInstructions[index]?.overrideWords ?? ""}
                  onChange={e => editPart(index,"overrideWords",e.target.value)}/>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || hasUnsavedSettings} onClick={() => void compareLocal()}>
          Preview effective offline plan and prompts
        </Button>
        <Button disabled={busy || hasUnsavedSettings || !preview} onClick={() => void persistPlan()}>
          Save immutable draft plan
        </Button>
        <Button disabled={busy} onClick={() => {
          setPlanId(studioPlanId());setPreview(null);setSaved(null);setMessageText("New draft plan identity created.");
        }}>New draft plan ID</Button>
      </div>
      {preview && (
        <div className="space-y-2 rounded border border-line p-2">
          <p className="text-xs font-semibold">Effective configuration · revision {preview.plan.configRevision} ·
            {preview.plan.partCount} parts · {preview.plan.totalWords.toLocaleString()} words</p>
          <p className="break-all text-xs">Plan ID: {preview.plan.planId} · Snapshot SHA-256: {preview.plan.configDigest}</p>
          {preview.plan.warnings.map((text,index) => <p key={index} className="text-xs text-muted">Warning: {text}</p>)}
          <div className="max-h-64 space-y-1 overflow-auto">
            {preview.plan.parts.map(part => <p key={part.index} className="text-xs">
              {part.index}. {part.title || "Untitled"} — <strong>{part.targetWords.toLocaleString()} words</strong>
              {part.objective ? " · "+part.objective : ""}
            </p>)}
          </div>
          <label className="block text-xs">Exact local writing preview
            <textarea className={cn} rows={9} readOnly value={preview.writingPreview}/>
          </label>
          <label className="block text-xs">Exact local reviewer preview
            <textarea className={cn} rows={7} readOnly value={preview.reviewPreview}/>
          </label>
        </div>
      )}
      <details className="rounded border border-line p-2" open>
        <summary className="cursor-pointer font-semibold text-xs">Saved draft plans ({history.plans.length})</summary>
        {history.issues.map((issue,index) => <p role="alert" key={index} className="text-xs text-danger">{issue}</p>)}
        <div className="mt-2 max-h-48 space-y-1 overflow-auto">
          {history.plans.map(p => <div key={p.planId} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="break-all">{p.title || p.topic} · {p.partCount} parts ·
              {p.totalWords} words · config rev {p.configRevision}</span>
            <Button disabled={busy} onClick={() => void reopen(p.planId)}>Reopen</Button>
          </div>)}
          {history.plans.length === 0 && <p className="text-xs text-muted">No saved Studio plans for this channel.</p>}
        </div>
        {saved && <div className="mt-2 space-y-1 rounded border border-line p-2 text-xs">
          <p role="status">Saved plan {saved.planId} · {saved.createdAt}</p>
          <p>Owner: {saved.channelId} · source config revision {saved.configRevision} ·
            current channel changes cannot modify this snapshot.</p>
          <p>Language: {saved.language || "not set"} · writing mode: {saved.writingMode}
            {" · "}Review provider: {saved.reviewerProvider}</p>
          {saved.parts.map(p => <p key={p.index}>{p.index}. {p.title || "Untitled"} ·
            {p.targetWords} words · {p.objective}</p>)}
          <p>AI-generated parts: 0 · script approval: none · provider requests: 0</p>
        </div>}
      </details>
    </section>
  );
}
