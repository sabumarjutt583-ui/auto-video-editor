import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";
import type { LegacyChannelSeed, ScriptStudioPlanV1 } from "../../lib/script/studio/types.ts";
import { listStudioPlans } from "../../lib/script/studio/api.ts";
import type { CandidateValidation,ExecutionAction,ExecutionList,ExecutionRequest,ExecutionState } from "../../lib/script/execution/types.ts";
import {
  applyExecution,buildExecutionRequest,errorDescription,getExecution,listExecutions,
  newExecutionId,newExecutionOperationId,readCandidate,readExecution,startExecution,validateCandidate,
} from "../../lib/script/execution/api.ts";

const cn="w-full rounded border border-line bg-surface p-2 text-sm";
type ArtifactKind="outline"|"bible"|"prompt"|"continuation"|"part"|"assembled"|"handoff";
const emptyList:ExecutionList={executions:[],issues:[]};
interface Props{seed:LegacyChannelSeed}
/** Manual/offline only; all writes are Rust-authorized and revision checked. */
export function ScriptExecutionWorkspace({seed}:Props){
  const [plans,setPlans]=useState<ScriptStudioPlanV1[]>([]);
  const [planId,setPlanId]=useState("");
  const [records,setRecords]=useState<ExecutionList>(emptyList);
  const [session,setSession]=useState<ExecutionState|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [outline,setOutline]=useState("");
  const [bible,setBible]=useState("");
  const [continuity,setContinuity]=useState("");
  const [extra,setExtra]=useState("");
  const [response,setResponse]=useState("");
  const [readText,setReadText]=useState("");
  const [readLabel,setReadLabel]=useState("");
  const [candidate,setCandidate]=useState("");
  const [validation,setValidation]=useState<CandidateValidation|null>(null);
  const [candidateReviewed,setCandidateReviewed]=useState(false);
  const [acceptWarnings,setAcceptWarnings]=useState(false);
  const [historyPart,setHistoryPart]=useState(1);
  const pending=useRef<{key:string;request:ExecutionRequest}|null>(null);
  const pendingStart=useRef<{planId:string;input:{channelId:string;planId:string;executionId:string;operationId:string}}|null>(null);
  useEffect(()=>{
    let active=true;
    setPlans([]);setPlanId("");setRecords(emptyList);setSession(null);
    setOutline("");setBible("");setContinuity("");setCandidate("");setReadText("");
    pending.current=null;pendingStart.current=null;
    void Promise.allSettled([listStudioPlans(seed.channelId),listExecutions(seed)]).then(([p,e])=>{
      if(!active)return;
      if(p.status==="fulfilled"){setPlans(p.value.plans);setPlanId(p.value.plans[0]?.planId??"");}
      else{setError(errorDescription(p.reason));}
      if(e.status==="fulfilled")setRecords(e.value);
      else setError(errorDescription(e.reason));
    });
    return ()=>{active=false};
  },[seed.channelId]);
  const current=session?.parts.find(p=>p.index===session.completedParts+1);
  const selectedPlan=plans.find(p=>p.planId===planId);
  async function refresh(){
    setBusy(true);setError("");
    try{
      const [p,e]=await Promise.all([listStudioPlans(seed.channelId),listExecutions(seed)]);
      setPlans(p.plans);setRecords(e);
      if(session)setSession(await getExecution(seed,session.executionId));
      setMessage("Saved executions and plans reloaded from Rust-owned storage.");
    }catch(e){setError(errorDescription(e))}
    finally{setBusy(false)}
  }
  async function open(id:string){
    if(busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const result=await getExecution(seed,id);
      setSession(result);pending.current=null;setCandidate("");setValidation(null);setResponse("");
      setReadText("");setReadLabel("");setHistoryPart(1);
      const [o,b]=await Promise.all([
        result.outlineVersions.length?readExecution(seed,id,"outline"):Promise.resolve(""),
        result.bibleVersions.length?readExecution(seed,id,"bible"):Promise.resolve("")
      ]);
      setOutline(o);setBible(b);setMessage("Execution reopened from committed local checkpoints. No provider contact.");
    }catch(e){setError(errorDescription(e))}
    finally{setBusy(false)}
  }
  async function start(){
    if(busy||!selectedPlan)return;
    setBusy(true);setError("");
    try{
      if(pendingStart.current?.planId!==selectedPlan.planId){
        pendingStart.current={planId:selectedPlan.planId,input:{
          channelId:seed.channelId,planId:selectedPlan.planId,
          executionId:newExecutionId(),operationId:newExecutionOperationId()
        }};
      }
      const started=await startExecution(seed,pendingStart.current.input);
      pendingStart.current=null;setSession(started);setCandidate("");setOutline("");setBible("");
      setContinuity("");setResponse("");setReadText("");
      setRecords(await listExecutions(seed));
      setMessage("New offline execution committed. No AI writing request was sent.");
    }catch(e){setError(errorDescription(e))}
    finally{setBusy(false)}
  }
  async function action(op:ExecutionAction){
    if(!session||busy)return;
    const key=JSON.stringify([session.executionId,session.revision,op]);
    if(pending.current?.key!==key){
      pending.current={key,request:buildExecutionRequest(session,op)};
    }
    setBusy(true);setError("");setMessage("");
    try{
      const next=await applyExecution(seed,pending.current.request);
      pending.current=null;setSession(next);
      setRecords(await listExecutions(seed));
      setMessage("Committed local execution checkpoint "+next.revision+". No provider submission.");
      if(op.kind==="prepare_part"||op.kind==="prepare_continuation"){
        const text=await readExecution(seed,next.executionId,op.kind==="prepare_part"?"prompt":"continuation",op.partIndex);
        setReadLabel(op.kind==="prepare_part"?"Prepared part instructions":"Prepared continuation instructions");
        setReadText(text);
      }
      if(op.kind==="import_fragment"||op.kind==="commit_part"){
        setResponse("");setCandidate("");setValidation(null);setCandidateReviewed(false);setAcceptWarnings(false);
      }
      if(op.kind==="assemble"||op.kind==="prepare_handoff"){
        const kind=op.kind==="assemble"?"assembled":"handoff";
        setReadText(await readExecution(seed,next.executionId,kind));
        setReadLabel(kind==="assembled"?"Final immutable assembled script":"Offline reviewer handoff (not reviewed)");
      }
    }catch(e){setError(errorDescription(e))}
    finally{setBusy(false)}
  }
  async function inspect(kind:ArtifactKind,partIndex=0){
    if(!session)return;
    setBusy(true);setError("");
    try{
      const text=await readExecution(seed,session.executionId,kind,partIndex);
      setReadText(text);setReadLabel(kind+" — "+(partIndex?"Part "+partIndex:"saved artifact"));
    }catch(e){setError(errorDescription(e))}
    finally{setBusy(false)}
  }
  async function showCandidate(){
    if(!session||!current)return;
    setBusy(true);setError("");
    try{
      const [text,findings]=await Promise.all([
        readCandidate(seed,session.executionId,current.index),
        validateCandidate(seed,session.executionId,current.index)
      ]);
      setCandidate(text);setValidation(findings);setCandidateReviewed(true);
      setMessage("Candidate reconstructed from immutable fragments. Check overlap and ending before committing.");
    }catch(e){setError(errorDescription(e))}
    finally{setBusy(false)}
  }
  async function copy(text:string){
    try{await navigator.clipboard.writeText(text);setMessage("Exact visible text copied; nothing was submitted.");}
    catch{setError("Clipboard was unavailable. Select and copy the read-only text manually.");}
  }
  if(!import.meta.env.DEV)return null;
  return <section className="space-y-3 rounded border border-line p-3" aria-label="Offline Script Execution Workspace">
    <h4 className="font-semibold">Script Execution Workspace · Phase 03I · Development Only</h4>
    <p className="text-xs text-muted">Start from an immutable saved Studio plan. Manually copy prompts and import actual responses.
      Original fragments, notes, parts and assemblies remain separate. No account is opened and no AI request is sent.</p>
    {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
    {message&&<p role="status" className="text-xs text-muted">{message}</p>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex-1 text-xs">Saved immutable plan
        <select aria-label="Saved plan" className={cn} value={planId} onChange={e=>setPlanId(e.target.value)}>
          {plans.map(p=><option value={p.planId} key={p.planId}>{p.title||p.topic} · {p.partCount} parts · {p.totalWords} words</option>)}
        </select>
      </label>
      <Button disabled={busy||!selectedPlan} onClick={()=>void start()}>Start new execution</Button>
      <Button disabled={busy} onClick={()=>void refresh()}>Reload saved executions</Button>
    </div>
    {records.issues.map((issue,i)=><p key={i} role="alert" className="text-xs text-danger">{issue}</p>)}
    <div className="max-h-40 space-y-1 overflow-auto">
      {records.executions.map(r=><div key={r.executionId} className="flex flex-wrap items-center gap-2 text-xs">
        <span className="break-all">{r.executionId} · {r.completedParts}/{r.totalParts} completed · {r.status}</span>
        <Button disabled={busy} onClick={()=>void open(r.executionId)}>Resume / inspect</Button>
      </div>)}
      {!records.executions.length&&<p className="text-xs text-muted">No execution sessions saved for this channel.</p>}
    </div>
    {session&&<div className="space-y-3 border-t border-line pt-3">
      <p className="break-all text-xs">Channel: {session.channelId} · Plan: {session.planId} ·
        Execution: {session.executionId} · Revision: {session.revision}</p>
      <p className="text-sm font-medium">{session.completedParts} of {session.totalParts} parts completed ·
        {session.status} · next part {current?.index??"none"}</p>
      <details className="rounded border border-line p-2" open>
        <summary className="font-semibold text-xs">Outline & Script Bible</summary>
        <p className="text-xs text-muted">These are user-provided versions, not AI-generated or fact-checked. Save separately.</p>
        <label className="block text-xs mt-2">Outline
          <textarea className={cn} value={outline} rows={5} onChange={e=>setOutline(e.target.value)} />
        </label>
        <Button disabled={busy||session.status!=="active"||!outline.trim()} onClick={()=>void action({kind:"save_outline",text:outline})}>
          Save immutable outline version
        </Button>
        <label className="block text-xs mt-2">Script Bible · chronology, characters, facts, tone, ending and dependencies
          <textarea className={cn} value={bible} rows={5} onChange={e=>setBible(e.target.value)}/>
        </label>
        <Button disabled={busy||session.status!=="active"||!bible.trim()} onClick={()=>void action({kind:"save_bible",text:bible})}>
          Save immutable Script Bible version
        </Button>
        <p className="text-xs text-muted">{session.outlineVersions.length} outline revisions · {session.bibleVersions.length} Bible revisions</p>
      </details>
      {current&&<div className="space-y-2 rounded border border-line p-2">
        <p className="font-semibold text-sm">Part {current.index} of {session.totalParts} — {current.title||"Untitled"}</p>
        <p className="text-xs">Objective: {current.objective||"Use saved plan objective"} · Target: {current.targetWords} words
          {" · "}Committed fragments: {current.fragments.length}</p>
        <label className="block text-xs">Additional part-specific instructions
          <textarea className={cn} value={extra} rows={2} onChange={e=>setExtra(e.target.value)}/>
        </label>
        {!current.prepared&&<Button disabled={busy} onClick={()=>void action({kind:"prepare_part",partIndex:current.index,extraInstructions:extra})}>
          Prepare Part {current.index} instructions
        </Button>}
        {current.prepared&&<div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={()=>void inspect("prompt",current.index)}>Read exact prepared instructions</Button>
          {current.fragments.length>0&&<Button disabled={busy} onClick={()=>void action({
            kind:"prepare_continuation",partIndex:current.index,extraInstructions:extra
          })}>Prepare continuation of incomplete part</Button>}
          {current.continuationPrompts.length>0&&<Button disabled={busy}
            onClick={()=>void inspect("continuation",current.index)}>Read latest continuation instructions</Button>}
        </div>}
        {current.prepared&&<label className="block text-xs">Manual response or continuation fragment · exact Unicode preserved
          <textarea aria-label="Import exact part text" className={cn} value={response} rows={7} onChange={e=>setResponse(e.target.value)}
            placeholder="Paste the original provider response exactly. Do not trim whitespace."/>
        </label>}
        <Button disabled={busy||!current.prepared||!response.trim()||current.fragments.length>=16}
          onClick={()=>void action({kind:"import_fragment",partIndex:current.index,text:response})}>
          Commit immutable response fragment
        </Button>
        {current.fragments.map((fragment,i)=><div key={fragment.filename} className="flex flex-wrap gap-2 items-center text-xs">
          <span>Fragment {i+1} · {fragment.bytes} bytes · {fragment.sha256.slice(0,24)}…</span>
          <Button disabled={busy} onClick={()=>void readExecution(seed,session.executionId,"fragment",current.index,i)
            .then(text=>{setReadText(text);setReadLabel("Original fragment "+(i+1));})
            .catch(e=>setError(errorDescription(e)))}>Inspect original</Button>
        </div>)}
        {current.fragments.length>0&&<>
          <Button disabled={busy} onClick={()=>void showCandidate()}>Review reconstructed candidate & overlap</Button>
          {candidateReviewed&&<>
            <label className="block text-xs">Candidate Part {current.index} (read-only; fragments joined by one LF)
              <textarea className={cn} value={candidate} readOnly rows={8}/>
            </label>
            {validation&&<div className="space-y-1 text-xs">
              <p>Rule-based count: {validation.actualWordEstimate} / {validation.targetWords} target words
                {" · "}fragments: {validation.fragmentCount} · SHA-256: {validation.contentSha256}</p>
              {validation.findings.length===0
                ?<p className="text-muted">No technical warnings under the local deterministic checks; this is not an AI quality review.</p>
                :validation.findings.map((finding,i)=><p role="alert" key={i} className="text-danger">Warning: {finding}</p>)}
            </div>}
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={acceptWarnings}
              onChange={e=>setAcceptWarnings(e.target.checked)}/>
              I inspected the candidate, including possible duplicate overlap, word count and unfinished ending.
              Accept technical warnings if any.
            </label>
            <Button disabled={busy||!acceptWarnings} onClick={()=>void action({
              kind:"commit_part",partIndex:current.index,acceptWarnings:true
            })}>Validate and commit completed Part {current.index}</Button>
          </>}
        </>}
      </div>}
      {session.completedParts>0&&session.status==="active"&&<details className="rounded border border-line p-2" open>
        <summary className="text-xs font-semibold">Verified part continuity notes</summary>
        <p className="text-xs text-muted">Explicitly record established facts, already-covered topics, transitions,
          chronology and outstanding threads. Nothing is automatically invented.</p>
        <label className="block text-xs">Notes after completed Part {session.completedParts}
          <textarea className={cn} value={continuity} rows={4} onChange={e=>setContinuity(e.target.value)}/>
        </label>
        <Button disabled={busy||!continuity.trim()} onClick={()=>void action({
          kind:"save_continuity",afterPart:session.completedParts,text:continuity
        })}>Save continuity for next part</Button>
        <p className="text-xs">Saved continuity versions: {session.continuityNotes.length}</p>
      </details>}
      <details className="rounded border border-line p-2">
        <summary className="font-semibold text-xs">Committed part history and validation findings</summary>
        {session.parts.map(p=><div key={p.index} className="flex flex-wrap items-center gap-2 py-1 text-xs">
          <span>{p.index}. {p.committed?"Committed":"Pending"} · {p.actualWords??"—"} estimated words / {p.targetWords} planned</span>
          {p.committed&&<Button disabled={busy} onClick={()=>{setHistoryPart(p.index);void inspect("part",p.index)}}>
            Inspect saved Part {p.index}</Button>}
          {p.validationFindings.map((warning,i)=><p role="alert" key={i} className="w-full text-xs text-muted">Part {p.index}: {warning}</p>)}
        </div>)}
        <p className="text-xs text-muted">Selected history part: {historyPart}</p>
      </details>
      {session.completedParts===session.totalParts&&<div className="space-y-2 rounded border border-line p-2">
        <p className="font-semibold text-sm">Final assembly and offline review handoff</p>
        {session.status==="active"&&<Button disabled={busy} onClick={()=>void action({kind:"assemble"})}>
          Verify saved part hashes & assemble immutable final script
        </Button>}
        {session.assembled&&<Button disabled={busy} onClick={()=>void inspect("assembled")}>
          Inspect / copy final assembled script ({session.assembledWords} whitespace-token words)
        </Button>}
        {session.status==="assembled"&&<Button disabled={busy}
          onClick={()=>void action({kind:"prepare_handoff"})}>Prepare immutable offline review handoff</Button>}
        {session.handoff&&<Button disabled={busy} onClick={()=>void inspect("handoff")}>Inspect review package (not reviewed or approved)</Button>}
      </div>}
      {readLabel&&<div className="space-y-2">
        <label className="block text-xs">{readLabel}
          <textarea className={cn} value={readText} readOnly rows={10}/>
        </label>
        <Button disabled={!readText} onClick={()=>void copy(readText)}>Copy exact saved text</Button>
      </div>}
    </div>}
  </section>;
}
