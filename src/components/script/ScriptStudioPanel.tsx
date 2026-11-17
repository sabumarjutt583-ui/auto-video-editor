import { useEffect, useRef, useState } from "react";
import type { ChannelProfile } from "../../lib/pipeline/profile.ts";
import {
  buildStudioEdit, getStudioConfig, getStudioHistory,
  listStudioChatGptAccounts, listStudioClaudeAccounts, parseStudioError,
  saveStudioConfig, seedFromProfile, studioOperationId,
} from "../../lib/script/studio/api.ts";
import type {
  ChannelStudioConfigV1, StudioAccountMetadata,
} from "../../lib/script/studio/types.ts";
import { Button } from "../ui";
import { StudioConfigSections } from "./StudioConfigSections";
import { StudioPlanner } from "./StudioPlanner";
import { ScriptExecutionWorkspace } from "./ScriptExecutionWorkspace";
import { ScriptReviewWorkspace } from "./ScriptReviewWorkspace";
import { AiWorkflowControlCenter } from "./AiWorkflowControlCenter";
import { StudioBackupPanel } from "./StudioBackupPanel";

interface Props { readonly profiles: readonly ChannelProfile[]; readonly initialChannelId?: string; }
const cn = "w-full rounded border border-line bg-surface p-2 text-sm";
function safeError(error:unknown):string {
  const x=parseStudioError(error);
  return x ? x.code+": "+x.message : "Offline Studio operation failed. Existing saved files remain unchanged.";
}

/** Entire interface is development-only; no live generation/Claude/browser imports. */
export function ScriptStudioPanel({profiles,initialChannelId}:Props) {
  const [opened,setOpened]=useState(false);
  const [channelId,setChannelId]=useState(initialChannelId ?? profiles[0]?.id ?? "");
  const profile=profiles.find(item=>item.id===channelId) ?? profiles[0] ?? null;
  const [config,setConfig]=useState<ChannelStudioConfigV1|null>(null);
  const [draft,setDraft]=useState<ChannelStudioConfigV1|null>(null);
  const [claude,setClaude]=useState<StudioAccountMetadata[]>([]);
  const [chatgpt,setChatgpt]=useState<StudioAccountMetadata[]>([]);
  const [newMaster,setNewMaster]=useState("");
  const [newReviewer,setNewReviewer]=useState("");
  const [masterParts,setMasterParts]=useState<number|null>(null);
  const [history,setHistory]=useState<ChannelStudioConfigV1[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const pendingSave=useRef<{key:string;operationId:string}|null>(null);
  const seed=profile ? seedFromProfile(profile):null;
  const dirty=config!==null && draft!==null && (
    JSON.stringify(draft)!==JSON.stringify(config) ||
    newMaster.length>0 || newReviewer.length>0 || masterParts!==null
  );
  const rubricTotal=draft?.rubric.reduce((sum,item)=>sum+item.points,0) ?? 0;

  useEffect(()=>{
    if(!profiles.some(profile=>profile.id===channelId)){
      setChannelId(profiles[0]?.id??"");
    }
  },[profiles,channelId]);
  useEffect(()=>{
    setConfig(null);setDraft(null);setError("");setNotice("");setHistory([]);
    setNewMaster("");setNewReviewer("");setMasterParts(null);pendingSave.current=null;
    if(!opened || !profile) return;
    let live=true;
    const seed=seedFromProfile(profile);
    setBusy(true);
    void Promise.allSettled([
      getStudioConfig(seed),listStudioClaudeAccounts(),listStudioChatGptAccounts(),
    ]).then(results=>{
      if(!live)return;
      const base=results[0];
      if(base.status==="fulfilled"){
        setConfig(base.value);setDraft(base.value);
        setNotice("Local Studio configuration loaded. Legacy channel and project settings were not modified.");
      } else {
        setError(safeError(base.reason));
      }
      const c=results[1];
      const g=results[2];
      setClaude(c.status==="fulfilled"?c.value:[]);
      setChatgpt(g.status==="fulfilled"?g.value:[]);
      if(c.status==="rejected"||g.status==="rejected"){
        setError("One or more existing account managers could not be read. Account selections may be unavailable; no reassignment was performed.");
      }
    }).finally(()=>{if(live)setBusy(false);});
    return ()=>{live=false;};
  },[opened,profile?.id]);

  async function reload(){
    if(!seed)return;
    setBusy(true);setError("");setNotice("");
    try{
      const value=await getStudioConfig(seed);
      setConfig(value);setDraft(value);setNewMaster("");setNewReviewer("");setMasterParts(null);
      pendingSave.current=null;
      setNotice("Latest committed configuration reloaded. Any local unsaved edits were discarded.");
    }catch(caught){setError(safeError(caught));}
    finally{setBusy(false);}
  }
  async function save(){
    if(!seed||!draft||!config||busy)return;
    if(rubricTotal!==100){
      setError("The review rubric must total exactly 100 points before saving.");return;
    }
    if(masterParts!==null && (!Number.isSafeInteger(masterParts)||masterParts<1||masterParts>40)){
      setError("Structured prompt part count must be between 1 and 40.");return;
    }
    const key=JSON.stringify([draft,newMaster,newReviewer,masterParts]);
    if(pendingSave.current?.key!==key){
      pendingSave.current={key,operationId:studioOperationId("studio")};
    }
    const edit=buildStudioEdit(draft,pendingSave.current.operationId,{
      newMasterPrompt:newMaster || null,
      newReviewPrompt:newReviewer || null,
      newMasterPlanning:newMaster && masterParts!==null ? {defaultPartCount:masterParts}:null,
    });
    setBusy(true);setError("");setNotice("");
    try{
      const saved=await saveStudioConfig(seed,edit);
      setConfig(saved);setDraft(saved);setNewMaster("");setNewReviewer("");setMasterParts(null);
      pendingSave.current=null;
      setNotice("Studio revision "+saved.revision+" saved durably. No provider or video work was started.");
    }catch(caught){setError(safeError(caught));}
    finally{setBusy(false);}
  }
  async function inspectHistory(){
    if(!seed)return;
    setBusy(true);setError("");
    try{setHistory(await getStudioHistory(seed));}
    catch(caught){setError(safeError(caught));}
    finally{setBusy(false);}
  }
  if(!import.meta.env.DEV)return null;
  return (
    <details className="mt-4 rounded-xl border border-dashed border-line bg-surface p-4"
      open={opened} onToggle={event=>setOpened(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">Script Writer Studio — Development Only · Offline</summary>
      {opened && <div className="mt-4 space-y-4">
        <p className="text-sm text-muted">Channel-owned writing prompts, local Skill registrations, account
          preferences, review rubrics and immutable draft plans. Nothing calls Claude, ChatGPT or the video pipeline.
          Save changes here does not modify legacy Channel Settings.</p>
        <label className="block text-xs">Existing YouTube channel
          <select className={cn} value={profile?.id??""} onChange={e=>setChannelId(e.target.value)}>
            {profiles.map(item=><option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
        {busy && <p role="status" className="text-xs text-muted">Local Studio operation in progress…</p>}
        {profile && seed && config && draft && (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded border border-line p-2">
              <p className="text-xs">Owner: <strong>{config.channelId}</strong> · saved revision:
                {config.revision} · {dirty?" UNSAVED LOCAL CHANGES":" all Studio changes saved"}</p>
              <Button disabled={busy || !dirty || rubricTotal!==100} onClick={()=>void save()}>
                Save Studio configuration & new prompt versions
              </Button>
              <Button disabled={busy} onClick={()=>void reload()}>Reload committed config</Button>
            </div>
            {config.revision===0 && <p className="text-xs text-muted">
              Legacy master prompt has been loaded read-only as the initial version. No Studio record
              has been saved yet. Saving creates the channel's own separate local history.
            </p>}
            <StudioConfigSections key={config.channelId} config={draft} onChange={setDraft}
              newMaster={newMaster} setNewMaster={setNewMaster}
              newReviewPrompt={newReviewer} setNewReviewPrompt={setNewReviewer}
              newMasterParts={masterParts} setNewMasterParts={setMasterParts}
              claude={claude} chatgpt={chatgpt} />
            <div className="rounded border border-line p-3 space-y-2">
              <p className="font-semibold text-sm">Committed configuration history</p>
              <Button disabled={busy} onClick={()=>void inspectHistory()}>Read immutable configuration checkpoints</Button>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {history.map(item=><p key={item.revision} className="break-all text-xs">
                  Revision {item.revision} · {item.updatedAt} · prompts: {item.promptVersions.length} ·
                  reviewer versions: {item.reviewVersions.length} · channel ID: {item.channelId}
                </p>)}
              </div>
            </div>
            <StudioPlanner key={config.channelId} config={config} seed={seed}
              hasUnsavedSettings={dirty}/>
            <ScriptExecutionWorkspace key={config.channelId} seed={seed}/>
            <ScriptReviewWorkspace key={config.channelId} seed={seed}/>
            <AiWorkflowControlCenter key={config.channelId} seed={seed}/>
            <StudioBackupPanel key={config.channelId} config={config} seed={seed}
              claude={claude} chatgpt={chatgpt}
              onImported={next=>{
                setConfig(next);setDraft(next);
                setNewMaster("");setNewReviewer("");setMasterParts(null);
                setNotice("Imported Studio configuration owns this channel ID. No external AI action occurred.");
              }}/>
          </>
        )}
        {!profile && <p role="alert" className="text-xs text-danger">
          No saved channel found. Create a channel using the existing Channel Settings flow first.
        </p>}
      </div>}
    </details>
  );
}
