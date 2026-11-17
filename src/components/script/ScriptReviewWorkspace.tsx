import {useEffect,useRef,useState} from "react";
import type {LegacyChannelSeed} from "../../lib/script/studio/types.ts";
import {listExecutions} from "../../lib/script/execution/api.ts";
import type {ExecutionState} from "../../lib/script/execution/types.ts";
import {
 applyReview,buildReviewRequest,getReview,hasFullCoverage,isCurrentApproved,listReviews,
 newReviewId,newReviewOperation,readReview,readReviewHistory,reviewError,startReview,sumScore
} from "../../lib/script/review/api.ts";
import type {ReviewAction,ReviewList,ReviewRequest,ReviewState,Report} from "../../lib/script/review/types.ts";
import {Button} from "../ui";

const field="w-full rounded border border-line bg-surface p-2 text-sm";
const empty:ReviewList={reviews:[],issues:[]};
interface Props {seed:LegacyChannelSeed}
/** Visible only within the development-only Studio. No browser/AI or video pipeline APIs. */
export function ScriptReviewWorkspace({seed}:Props){
 const [executions,setExecutions]=useState<ExecutionState[]>([]);
 const [executionId,setExecutionId]=useState("");
 const [part,setPart]=useState("final");
 const [reviews,setReviews]=useState<ReviewList>(empty);
 const [session,setSession]=useState<ReviewState|null>(null);
 const [section,setSection]=useState(0);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [prompt,setPrompt]=useState("");
 const [raw,setRaw]=useState("");
 const [correction,setCorrection]=useState("");
 const [goalText,setGoalText]=useState("");
 const [improvement,setImprovement]=useState("");
 const [newScript,setNewScript]=useState("");
 const [original,setOriginal]=useState("");
 const [revised,setRevised]=useState("");
 const [mode,setMode]=useState<"single"|"part"|"final"|"continuity"|"improvement">("final");
 const [confirm,setConfirm]=useState(false);
 const [approvalWord,setApprovalWord]=useState("");
 const [historicalRound,setHistoricalRound]=useState(0);
 const [historicalSection,setHistoricalSection]=useState(0);
 const [historicalText,setHistoricalText]=useState("");
 const [historicalLabel,setHistoricalLabel]=useState("");
 const [compareFrom,setCompareFrom]=useState(0);
 const [compareTo,setCompareTo]=useState(0);
 const retry=useRef<{key:string;request:ReviewRequest}|null>(null);
 const startRetry=useRef<{key:string;input:{channelId:string;executionId:string;reviewId:string;partIndex:number|null;operationId:string}}|null>(null);

 useEffect(()=>{
  let live=true;
  setExecutions([]);setReviews(empty);setSession(null);setExecutionId("");setPart("final");
  retry.current=null;startRetry.current=null;
  void Promise.allSettled([listExecutions(seed),listReviews(seed)]).then(([a,b])=>{
   if(!live)return;
   if(a.status==="fulfilled"){
    const usable=a.value.executions.filter(s=>Boolean(s.assembled)||s.parts.some(p=>Boolean(p.committed)));
    setExecutions(usable);setExecutionId(usable[0]?.executionId??"");
   }else setError(reviewError(a.reason));
   if(b.status==="fulfilled")setReviews(b.value);else setError(reviewError(b.reason));
  });
  return ()=>{live=false};
 },[seed.channelId]);
 const chosen=executions.find(e=>e.executionId===executionId);
 const round=session?.rounds.at(-1);
 const active=round?.sections[section]??null;
 const currentVersion=session?.versions.at(-1)??null;
 const covered=session?hasFullCoverage(session):false;
 const approved=session?isCurrentApproved(session):false;

 async function refresh(){
  setBusy(true);setError("");
  try{
   const [a,b]=await Promise.all([listExecutions(seed),listReviews(seed)]);
   const usable=a.executions.filter(s=>Boolean(s.assembled)||s.parts.some(p=>Boolean(p.committed)));
   setExecutions(usable);setReviews(b);
   if(session)await open(session.reviewId);
   setNotice("Recovered channel-owned reviews and immutable execution list from disk.");
  }catch(e){setError(reviewError(e))}
  finally{setBusy(false)}
 }
 async function showArtifacts(next:ReviewState,focus=0){
  const selected=Math.min(focus,next.rounds.at(-1)!.sections.length-1);
  const latest=next.versions.at(-1)!;
  const [p,a,b]=await Promise.all([
   readReview(seed,next.reviewId,"prompt",selected),
   readReview(seed,next.reviewId,"script",0),
   readReview(seed,next.reviewId,"script",latest.index)
  ]);
  setPrompt(p);setOriginal(a);setRevised(b);setSection(selected);setConfirm(false);setApprovalWord("");
  setHistoricalRound(next.rounds.length-1);setHistoricalSection(0);setHistoricalText("");setHistoricalLabel("");
  setCompareFrom(0);setCompareTo(latest.index);
  const sec=next.rounds.at(-1)!.sections[selected];
  setCorrection(sec.report?JSON.stringify(sec.report,null,2):"");
  setRaw("");
  setImprovement("");
  if(latest.improvementPrompt){
   setImprovement(await readReview(seed,next.reviewId,"improvement"));
  }
 }
 async function open(id:string){
  setBusy(true);setError("");
  try{
   const state=await getReview(seed,id);
   setSession(state);retry.current=null;await showArtifacts(state);
   setNotice("Review and approval history reopened. Source is user-reported/manual, not verified AI.");
  }catch(e){setError(reviewError(e))}
  finally{setBusy(false)}
 }
 async function create(){
  if(!chosen||busy)return;
  const key=JSON.stringify([chosen.executionId,part]);
  if(startRetry.current?.key!==key){
   startRetry.current={key,input:{
    channelId:seed.channelId,executionId:chosen.executionId,reviewId:newReviewId(),
    partIndex:part==="final"?null:Number(part),operationId:newReviewOperation()
   }};
  }
  setBusy(true);setError("");setNotice("");
  try{
   const saved=await startReview(seed,startRetry.current.input);
   startRetry.current=null;setSession(saved);retry.current=null;await showArtifacts(saved);
   setReviews(await listReviews(seed));
   setNotice("Durable offline review created from exact immutable execution content.");
  }catch(e){setError(reviewError(e))}
  finally{setBusy(false)}
 }
 async function act(action:ReviewAction){
  if(!session||busy)return;
  const key=JSON.stringify([session.reviewId,session.revision,action]);
  if(retry.current?.key!==key)retry.current={key,request:buildReviewRequest(session,action)};
  setBusy(true);setError("");setNotice("");
  try{
   const next=await applyReview(seed,retry.current.request);
   retry.current=null;setSession(next);
   await showArtifacts(next,action.kind==="import_response"||action.kind==="correct_response"?section:0);
   setReviews(await listReviews(seed));
   setNotice("Review checkpoint "+next.revision+" committed; no external request and no production handoff.");
   if(action.kind==="import_response"||action.kind==="correct_response"){
    const s=next.rounds.at(-1)!.sections[section];
    if(s.validationIssues.length)setNotice("Original raw response preserved. Correct invalid data explicitly; score remains unset.");
   }
   if(action.kind==="import_revision")setNewScript("");
  }catch(e){setError(reviewError(e))}
  finally{setBusy(false)}
 }
 async function chooseSection(index:number){
  if(!session)return;setBusy(true);setError("");
  try{
   setPrompt(await readReview(seed,session.reviewId,"prompt",index));setSection(index);
   const s=session.rounds.at(-1)!.sections[index];
   setCorrection(s.report?JSON.stringify(s.report,null,2):"");
   setRaw("");
  }catch(e){setError(reviewError(e))}
  finally{setBusy(false)}
 }
 async function inspectRaw(){
  if(!session||!active?.raw)return;
  setBusy(true);setError("");
  try{setRaw(await readReview(seed,session.reviewId,"raw",section))}
  catch(e){setError(reviewError(e))}finally{setBusy(false)}
 }
 function applyCorrection(){
  try{
   const value=JSON.parse(correction) as Report;
   if(!value||!Array.isArray(value.scores)||!Array.isArray(value.findings)||typeof value.summary!=="string"){
    setError("Correction JSON requires scores, findings and summary.");return;
   }
   void act({kind:"correct_response",sectionIndex:section,report:value});
  }catch{setError("Invalid correction JSON; original raw response remains saved.")}
 }
 async function openHistorical(kind:"script"|"prompt"|"raw"|"improvement",itemIndex:number){
  if(!session)return;
  setBusy(true);setError("");
  try{
   const text=await readReviewHistory(seed,session.reviewId,kind,historicalRound,itemIndex);
   setHistoricalLabel("Saved "+kind+" · round "+historicalRound+" · item "+itemIndex);
   setHistoricalText(text);
  }catch(e){setError(reviewError(e))}finally{setBusy(false)}
 }
 async function compareVersions(){
  if(!session)return;setBusy(true);setError("");
  try{
   const [a,b]=await Promise.all([
    readReview(seed,session.reviewId,"script",compareFrom),
    readReview(seed,session.reviewId,"script",compareTo)
   ]);
   setOriginal(a);setRevised(b);setNotice("Showing exact immutable comparison versions "+compareFrom+" and "+compareTo+".");
  }catch(e){setError(reviewError(e))}finally{setBusy(false)}
 }
 async function copy(text:string){
  try{await navigator.clipboard.writeText(text);setNotice("Exact visible text copied; nothing was sent.");}
  catch{setError("Clipboard unavailable. Select and copy the text manually.")}
 }
 if(!import.meta.env.DEV)return null;
 return <section className="space-y-3 rounded border border-line p-3" aria-label="Script Review Workspace">
  <h4 className="font-semibold">Professional Script Review · Phase 03J · Development Only</h4>
  <p className="text-xs text-muted">Manual, offline review with immutable originals, rubric scores, revised versions and user approval. Reviewer preference is metadata, not evidence of a provider request. No video or account automation.</p>
  {error&&<p className="text-xs text-danger" role="alert">{error}</p>}
  {notice&&<p className="text-xs text-muted" role="status">{notice}</p>}
  <div className="flex flex-wrap gap-2 items-end">
   <label className="flex-1 text-xs">Saved completed execution
    <select className={field} value={executionId} onChange={e=>{setExecutionId(e.target.value);setPart("final")}}>
     {executions.map(e=><option value={e.executionId} key={e.executionId}>{e.executionId} · {e.completedParts}/{e.totalParts} parts</option>)}
    </select>
   </label>
   <label className="text-xs">Review source
    <select className={field} value={part} onChange={e=>setPart(e.target.value)}>
     {chosen?.assembled&&<option value="final">Exact assembled final script</option>}
     {chosen?.parts.filter(p=>p.committed).map(p=><option key={p.index} value={p.index}>Part {p.index}</option>)}
    </select>
   </label>
   <Button disabled={busy||!chosen||(part==="final"&&!chosen.assembled)} onClick={()=>void create()}>Create immutable review</Button>
   <Button disabled={busy} onClick={()=>void refresh()}>Reload saved history</Button>
  </div>
  {reviews.issues.map((issue,i)=><p role="alert" className="text-xs text-danger" key={i}>{issue}</p>)}
  <div className="max-h-36 overflow-auto space-y-1">
   {reviews.reviews.map(r=><div key={r.reviewId} className="flex items-center flex-wrap gap-2 text-xs">
    <span>{r.reviewId} · {r.partIndex===null?"assembled":"part "+r.partIndex} · {r.versions.length} versions · {r.approvals.length} approvals</span>
    <Button disabled={busy} onClick={()=>void open(r.reviewId)}>Open history</Button>
   </div>)}
  </div>
  {session&&round&&currentVersion&&<div className="space-y-3 border-t border-line pt-3">
   <p className="text-xs break-all">Review: {session.reviewId} · Channel: {session.channelId} ·
    Execution: {session.executionId} · Plan: {session.planId} · Checkpoint: {session.revision}</p>
   <p className="text-xs break-all">Source digest: {session.sourceDigest} · Current version {currentVersion.index}: {currentVersion.text.sha256}</p>
   <details className="rounded border border-line p-2" open>
    <summary className="font-semibold text-sm">Reviewer configuration (immutable session snapshot)</summary>
    <p className="text-xs">Preferred provider: {session.policy.provider} · Account reference: {session.policy.accountRef??"none"} ·
     Prompt version: {session.policy.promptVersion??"none"}</p>
    <p className="text-xs break-all">Prompt digest: {session.policy.promptDigest??"no custom prompt"}</p>
    <p className="text-xs">Audience: {session.policy.audience||"unspecified"} · Tone: {session.policy.tone||"unspecified"} · Language: {session.policy.language}</p>
    <p className="font-semibold text-xs mt-2">100-point saved rubric</p>
    <table className="w-full text-xs"><tbody>
     {session.policy.rubric.map(c=><tr key={c.key}><td>{c.label} ({c.key})</td><td>{c.points} max</td></tr>)}
    </tbody></table>
    <p className="text-xs">Total: {session.policy.rubric.reduce((n,c)=>n+c.points,0)} points</p>
    <details><summary className="text-xs">Saved custom reviewer prompt</summary>
     <pre className="whitespace-pre-wrap break-words text-xs">{session.policy.promptText||"No custom reviewer prompt configured."}</pre>
    </details>
   </details>
   <div className="rounded border border-line p-2 space-y-2">
    <p className="font-semibold text-sm">Review request & exact coverage</p>
    <p className="text-xs">Round {round.index} · Script version {round.versionIndex} · Mode: {round.mode} ·
      {round.sections.filter(s=>s.report).length} of {round.sections.length} sections with validated manual reports</p>
    <p className="text-xs">{covered?"All sections have manual structured reviews.":"PARTIAL COVERAGE — do not call this a full review."}
      {" "}No provider identity or factual correctness is verified.</p>
    <div className="flex gap-1 flex-wrap">
     {round.sections.map(s=><Button key={s.index} disabled={busy} onClick={()=>void chooseSection(s.index)}>
      Section {s.index+1} · {s.score===null?"unscored":s.score+"/100"}
     </Button>)}
    </div>
    <textarea className={field} aria-label="Exact offline review prompt" readOnly rows={9} value={prompt}/>
    <Button disabled={busy||!prompt} onClick={()=>void copy(prompt)}>Copy exact review prompt</Button>
    {active&&!active.raw&&<label className="block text-xs">Paste reviewer response (original UTF-8 text or structured JSON)
     <textarea className={field} rows={6} value={raw} onChange={e=>setRaw(e.target.value)} placeholder="Manual reviewer output. Nothing is sent automatically."/>
    </label>}
    {active&&!active.raw&&<Button disabled={busy||!raw.trim()} onClick={()=>void act({kind:"import_response",sectionIndex:section,raw})}>Import exact raw response</Button>}
    {active?.raw&&<Button disabled={busy} onClick={()=>void inspectRaw()}>Read original immutable response</Button>}
    {active&&active.validationIssues.length>0&&<div>
     {active.validationIssues.map((issue,i)=><p className="text-xs text-danger" key={i}>{issue}</p>)}
     <label className="text-xs block">Explicit corrected JSON report (does not replace original raw)
      <textarea className={field} rows={7} value={correction} onChange={e=>setCorrection(e.target.value)}/>
     </label>
     <Button disabled={busy||!correction.trim()} onClick={applyCorrection}>Validate and save correction</Button>
    </div>}
    {active?.report&&<div className="space-y-1">
     <p className="font-semibold text-sm">Section {section+1} score: {active.score}/100 · Manual provenance</p>
     {session.policy.rubric.map(c=>{
      const earned=active.report?.scores.find(s=>s.key===c.key)?.points;
      return <p className="text-xs" key={c.key}>{c.label}: {earned??"missing"} / {c.points} · Deduction: {earned===undefined?"unknown":c.points-earned}</p>;
     })}
     <p className="text-xs">{active.report.summary}</p>
     {active.report.findings.map((f,i)=><p className="text-xs" key={i}><strong>{f.severity}: {f.category}</strong> — {f.summary} · {f.recommendation}</p>)}
    </div>}
    <p className="text-xs">Overall: {sumScore(session)===null?"No single full-script score (multiple or missing sections)":sumScore(session)+"/100 (single covered section only)"}</p>
   </div>
   <details className="rounded border border-line p-2 space-y-2">
    <summary className="font-semibold text-sm">Complete review history · immutable past rounds</summary>
    <label className="block text-xs">Historical review round
     <select className={field} value={historicalRound} onChange={e=>{setHistoricalRound(Number(e.target.value));setHistoricalSection(0);setHistoricalText("");}}>
      {session.rounds.map(r=><option value={r.index} key={r.index}>Round {r.index} · script version {r.versionIndex} · {r.mode} · {r.createdAt}</option>)}
     </select>
    </label>
    {session.rounds[historicalRound]&&<div className="space-y-2">
     <p className="text-xs">Version {session.rounds[historicalRound].versionIndex} ·
      {session.rounds[historicalRound].sections.filter(s=>s.report!==null).length} /
      {session.rounds[historicalRound].sections.length} sections with validated user-reported reviews</p>
     <label className="block text-xs">Historic section
      <select className={field} value={historicalSection} onChange={e=>{setHistoricalSection(Number(e.target.value));setHistoricalText("");}}>
       {session.rounds[historicalRound].sections.map(sec=><option key={sec.index} value={sec.index}>Section {sec.index+1} · {sec.score===null?"unscored":sec.score+"/100"}</option>)}
      </select>
     </label>
     <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={()=>void openHistorical("prompt",historicalSection)}>Read historical prompt</Button>
      <Button disabled={busy||!session.rounds[historicalRound].sections[historicalSection]?.raw}
       onClick={()=>void openHistorical("raw",historicalSection)}>Read historical original response</Button>
     </div>
     {session.rounds[historicalRound].sections[historicalSection]?.report&&
      <div className="space-y-1">
       <p className="text-xs">Saved structured report: {session.rounds[historicalRound].sections[historicalSection]?.score}/100</p>
       <p className="text-xs">{session.rounds[historicalRound].sections[historicalSection]?.report?.summary}</p>
       {session.rounds[historicalRound].sections[historicalSection]?.report?.findings.map((f,i)=>
        <p key={i} className="text-xs">{f.severity} · {f.category}: {f.summary} — {f.recommendation}</p>)}
      </div>}
     {historicalText&&<div><p className="text-xs">{historicalLabel}</p>
      <textarea className={field} readOnly value={historicalText} rows={7}/>
      <Button onClick={()=>void copy(historicalText)}>Copy saved historical content</Button></div>}
    </div>}
   </details>
   <div className="rounded border border-line p-2 space-y-2">
    <p className="font-semibold text-sm">Improve and compare immutable script versions</p>
    <label className="block text-xs">Improvement goals (one per line)
     <textarea className={field} value={goalText} rows={3} onChange={e=>setGoalText(e.target.value)}/>
    </label>
    <Button disabled={busy||!covered||Boolean(currentVersion.improvementPrompt)||!goalText.trim()} onClick={()=>void act({
     kind:"prepare_improvement",goals:goalText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
    })}>Prepare offline improvement prompt</Button>
    {improvement&&<div><textarea className={field} readOnly rows={6} value={improvement}/>
      <Button onClick={()=>void copy(improvement)}>Copy improvement prompt</Button></div>}
    {currentVersion.improvementPrompt&&<label className="block text-xs">Import manually revised script as a NEW immutable version
     <textarea className={field} value={newScript} rows={6} onChange={e=>setNewScript(e.target.value)}/>
    </label>}
    <Button disabled={busy||!currentVersion.improvementPrompt||!newScript.trim()} onClick={()=>void act({kind:"import_revision",text:newScript})}>Save revised script version (original preserved)</Button>
    <p className="text-xs">Version history: {session.versions.map(v=>v.index+" ["+v.text.bytes+" bytes]").join(" · ")}</p>
    <div className="flex flex-wrap items-end gap-2">
     <label className="text-xs">Compare version A
      <select className={field} value={compareFrom} onChange={e=>setCompareFrom(Number(e.target.value))}>
       {session.versions.map(v=><option value={v.index} key={v.index}>Version {v.index}</option>)}
      </select>
     </label>
     <label className="text-xs">Compare version B
      <select className={field} value={compareTo} onChange={e=>setCompareTo(Number(e.target.value))}>
       {session.versions.map(v=><option value={v.index} key={v.index}>Version {v.index}</option>)}
      </select>
     </label>
     <Button disabled={busy} onClick={()=>void compareVersions()}>Compare chosen immutable versions</Button>
    </div>
    {currentVersion.validationFindings.map((f,i)=><p key={i} role="alert" className="text-xs text-danger">{f}</p>)}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
     <div><p className="text-xs font-semibold">Comparison version {compareFrom}</p><pre className="whitespace-pre-wrap break-all max-h-56 overflow-auto text-xs border border-line p-2">{original}</pre></div>
     <div><p className="text-xs font-semibold">Comparison version {compareTo}</p><pre className="whitespace-pre-wrap break-all max-h-56 overflow-auto text-xs border border-line p-2">{revised}</pre></div>
    </div>
    {currentVersion.index>round.versionIndex&&<p role="alert" className="text-xs text-danger">The improved draft has not yet been reviewed. Start a new review; old scores cannot approve it.</p>}
    <label className="text-xs">Re-review mode
      <select className={field} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}>
       <option value="final">Final assembled script</option><option value="single">Single script</option>
       <option value="part">Part-level</option><option value="continuity">Continuity</option>
       <option value="improvement">Improvement</option>
      </select>
    </label>
    <Button disabled={busy||(!covered&&round.versionIndex===currentVersion.index)} onClick={()=>void act({kind:"prepare_review",mode})}>Prepare fresh version-bound review</Button>
   </div>
   <div className="rounded border border-line p-2 space-y-2">
    <p className="font-semibold text-sm">Final approval — explicit user confirmation only</p>
    <p className="text-xs">Current approval: {approved?"Approved exact revision":"Not approved"} ·
     Review coverage: {covered?"All sections":"Partial"} · Active digest: {currentVersion.text.sha256}</p>
    {session.approvals.map((a,i)=><p className="break-all text-xs" key={i}>Historical approval {i+1}: version {a.versionIndex} · round {a.roundIndex} · {a.confirmedAt} · {a.scriptDigest}</p>)}
    <label className="text-xs flex gap-2 items-start"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>
      I personally inspected the exact script and its reported review coverage. I understand this is not an AI guarantee.
    </label>
    <label className="text-xs block">Type APPROVE FINAL SCRIPT to confirm
     <input className={field} value={approvalWord} onChange={e=>setApprovalWord(e.target.value)}/>
    </label>
    <Button disabled={busy||approved||!confirm||approvalWord!=="APPROVE FINAL SCRIPT"||!covered||currentVersion.index!==round.versionIndex||session.partIndex!==null||currentVersion.validationFindings.length>0}
     onClick={()=>void act({kind:"approve",confirmation:approvalWord})}>Approve this exact script digest</Button>
    <p className="text-xs">Approval never sends content to voiceover, image generation or Make Video.</p>
   </div>
  </div>}
 </section>;
}
