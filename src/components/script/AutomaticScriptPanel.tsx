import {useEffect,useMemo,useState} from "react";
import {Button} from "../ui";
import type {LegacyChannelSeed,ChannelStudioConfigV1,ScriptMode} from "../../lib/script/studio/types.ts";
import {getStudioConfig} from "../../lib/script/studio/api.ts";
import {readReview} from "../../lib/script/review/api.ts";
import {readExecution} from "../../lib/script/execution/api.ts";
import {autoCapability,autoGenerate,autoList,autoStatus,autoControl,autoApprove,automaticProgress,
 type AutoMode,type AutoCapability,type AutoView} from "../../lib/script/automatic/api.ts";
import {canApproveExact,currentVersionApproved} from "../../lib/script/automatic/approval.ts";
const selectStyle="rounded border border-line bg-surface px-2 py-1 text-sm";
const errorMessage=(error:unknown):string=>{
 if(error&&typeof error==="object"&&"message" in error)return String(error.message);
 return String(error);
};
/** Development-only, complete deterministic MOCK automation. No CDP calls. */
export function AutomaticScriptPanel({seed}:{seed:LegacyChannelSeed}){
 const [config,setConfig]=useState<ChannelStudioConfigV1|null>(null);
 const [title,setTitle]=useState(""),[topic,setTopic]=useState("");
 const [scriptMode,setScriptMode]=useState<ScriptMode>("single");
 const [words,setWords]=useState(1800),[parts,setParts]=useState(10);
 const [target,setTarget]=useState(90),[rounds,setRounds]=useState(2);
 const [mode,setMode]=useState<AutoMode>("local_fixture");
 const [capability,setCapability]=useState<AutoCapability|null>(null);
 const [list,setList]=useState<{taskId:string;stage:string}[]>([]);
 const [selected,setSelected]=useState(""),[view,setView]=useState<AutoView|null>(null);
 const [working,setWorking]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [script,setScript]=useState(""),[previewedDigest,setPreviewedDigest]=useState(""),[confirmation,setConfirmation]=useState("");
 const [consent,setConsent]=useState(false);
 useEffect(()=>{
  let alive=true;setConfig(null);setList([]);setSelected("");setView(null);setError("");
  void Promise.allSettled([getStudioConfig(seed),autoList(seed)]).then(results=>{
   if(!alive)return;
   if(results[0].status==="fulfilled"){
    const c=results[0].value;setConfig(c);
    setScriptMode(c.planning.defaultScriptMode);
    setWords(c.planning.defaultTotalWords);
    setParts(c.planning.defaultPartCount);
   }else setError("Channel Studio settings unavailable: "+errorMessage(results[0].reason));
   if(results[1].status==="fulfilled")setList(results[1].value.map(x=>({taskId:x.taskId,stage:x.stage})));
   else setError("Automatic task history unavailable: "+errorMessage(results[1].reason));
  });
  return()=>{alive=false}
 },[seed.channelId]);
 useEffect(()=>{
  let alive=true;setCapability(null);
  void autoCapability(mode).then(x=>{if(alive)setCapability(x)})
   .catch(e=>{if(alive)setError(errorMessage(e))});
  return()=>{alive=false}
 },[mode]);
 useEffect(()=>{
  if(!selected){setView(null);return}
  let alive=true;let busy=false;
  const refresh=async()=>{
   if(busy)return;busy=true;
   try{const latest=await autoStatus(seed,selected);if(alive)setView(latest)}
   catch(e){if(alive)setError("Saved task inspection: "+errorMessage(e))}
   finally{busy=false}
  };
  void refresh();const timer=setInterval(()=>void refresh(),1200);
  return()=>{alive=false;clearInterval(timer)}
 },[seed.channelId,selected]);
 const valid=useMemo(()=>Boolean(config&&capability?.automatic&&capability?.authorized&&
  mode==="local_fixture"&&title.trim()&&words>=50&&words<=200000&&
  (scriptMode==="single"||parts>=1&&parts<=40&&words>=parts*50)&&target<=100&&rounds<=3),
  [config,capability,mode,title,words,scriptMode,parts,target,rounds]);
 const reviewerProvider=config?.review.provider??"none";
 const reviewerId=reviewerProvider==="chatgpt"?config?.accounts.chatgptReviewAccountId
  :reviewerProvider==="claude"?config?.accounts.claudeAccountId:null;
 async function generate(){
  if(!valid||working)return;setWorking(true);setError("");setNotice("");setScript("");setPreviewedDigest("");
  try{
   const result=await autoGenerate(seed,{title,topic,scriptMode,targetWords:words,partCount:scriptMode==="single"?1:parts,
    reviewTarget:target,maxImprovements:rounds,mode});
   setSelected(result.task.taskId);setView(result);
   setList(old=>[{taskId:result.task.taskId,stage:result.task.stage},...old]);
   setNotice("Autonomous local MOCK execution started. No consumer provider was contacted.");
  }catch(e){setError(errorMessage(e))}
  finally{setWorking(false)}
 }
 async function control(action:"pause"|"resume"|"cancel"|"recover"){
  if(!view||working)return;setWorking(true);setError("");setNotice("");
  try{const result=await autoControl(seed,view.task.taskId,action);setView(result);
   setNotice("Rust-owned automatic task control: "+action+". No provider request sent.");
  }catch(e){setError(errorMessage(e))}finally{setWorking(false)}
 }
 async function openScript(){
  if(!view?.execution.assembled)return;
  try{
   const latest=view.review?.versions.at(-1);
   // The assembled source is still inspectable after a reviewer failure.
   const original=await readExecution(seed,view.execution.executionId,"assembled",0,0);
   setScript(latest&&view.review?await readReview(seed,view.review.reviewId,"script",latest.index):original);
    setPreviewedDigest(latest?.text.sha256??"");
    setConsent(false);setConfirmation("");
  }catch(e){setError(errorMessage(e))}
 }
 async function approve(){
  if(!view||!consent||confirmation!=="APPROVE FINAL SCRIPT"||working||
    !canApproveExact(view,previewedDigest))return;
  setWorking(true);setError("");
  try{setView(await autoApprove(seed,view.task.taskId,confirmation,previewedDigest));
   setNotice("Explicit Rust-saved user approval recorded. Mock output remains MOCK.");setConsent(false);setConfirmation("");
  }catch(e){setError(errorMessage(e))}finally{setWorking(false)}
 }
 const reviewRound=view?.review?.rounds.at(-1);
 const quality=reviewRound&&reviewRound.sections.every(x=>x.score!==null)
  ?Math.min(...reviewRound.sections.map(s=>s.score??0)):null;
 const approved=currentVersionApproved(view);
 if(!import.meta.env.DEV)return null;
 return <section className="border rounded border-line p-3 space-y-3" aria-label="Phase 03M automatic script engine">
  <h5 className="font-semibold">Automatic Script Production · Phase 03M</h5>
  <p className="text-xs">Automatic MOCK execution is functional. Live Claude.ai/ChatGPT consumer automation is NOT authorized or enabled. No actual AI result is claimed. Existing visible-Chrome manual fallback remains below.</p>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
   <label>Video title<input className={selectStyle+" w-full"} value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} placeholder="Enter your video title"/></label>
   <label>Topic (optional)<input className={selectStyle+" w-full"} value={topic} onChange={e=>setTopic(e.target.value)} maxLength={2000}/></label>
   <label>Writing mode<select className={selectStyle+" w-full"} value={scriptMode} onChange={e=>setScriptMode(e.target.value as ScriptMode)}>
    <option value="single">Single Script</option><option value="multi_part">Multi-Part</option></select></label>
   <label>Execution mode<select className={selectStyle+" w-full"} value={mode} onChange={e=>setMode(e.target.value as AutoMode)}>
    <option value="local_fixture">Automatic deterministic fixture — MOCK only</option>
    <option value="authorized_browser">Consumer browser automation — BLOCKED</option></select></label>
   <label>Target words<input className={selectStyle+" w-full"} type="number" value={words} min={50} max={200000} onChange={e=>setWords(Number(e.target.value))}/></label>
   {scriptMode==="multi_part"&&<label>Number of parts<input className={selectStyle+" w-full"} type="number" value={parts} min={1} max={40} onChange={e=>setParts(Number(e.target.value))}/></label>}
   <label>Review threshold (mock scoring)<input className={selectStyle+" w-full"} type="number" value={target} min={0} max={100} onChange={e=>setTarget(Number(e.target.value))}/></label>
   <label>Maximum mock improvements<input className={selectStyle+" w-full"} type="number" value={rounds} min={0} max={3} onChange={e=>setRounds(Number(e.target.value))}/></label>
  </div>
  <p className="text-xs">Channel: <strong>{config?.channelName??seed.channelName}</strong> · Writer: Claude account {config?.accounts.claudeAccountId??"MISSING"} · Reviewer: {reviewerProvider} {reviewerId??"MISSING"} · Master Prompt: {config?.selectedPromptVersionId??"none"} · Skill: {config?.writing.selectedSkillId??"none"}. Local Skill registration does not verify remote activation.</p>
  <p className="text-xs">Automatic capability: {capability?.reason??"checking"}</p>
  <Button disabled={working||!valid||reviewerProvider==="none"||!reviewerId} onClick={()=>void generate()}>
   Generate Full Script · MOCK AUTOMATIC
  </Button>
  {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
  {notice&&<p role="status" className="text-xs">{notice}</p>}
  <label className="text-xs block">Saved automatic jobs
   <select className={selectStyle+" w-full"} value={selected} onChange={e=>{setSelected(e.target.value);setScript("");setPreviewedDigest("");setConfirmation("");setConsent(false)}}>
    <option value="">Select a saved automatic task</option>
    {list.map(item=><option value={item.taskId} key={item.taskId}>{item.taskId} · {item.stage}</option>)}
   </select>
  </label>
  {view&&<div className="rounded border border-line p-3 space-y-2">
   <p className="text-xs"><strong>{view.task.snapshot.plan.title}</strong> · {view.policy.mode} · source digest {view.task.snapshot.planSha256.slice(0,24)}</p>
   <p className="text-xs">Progress: {automaticProgress(view)}</p>
   <p className="text-xs">Actual saved words: {view.execution.assembledWords??view.execution.parts.reduce((n,p)=>n+(p.actualWords??0),0)} / {view.task.snapshot.plan.totalWords} target · current part {view.execution.completedParts+1} · step {view.task.stage}</p>
   <p className="text-xs">Writing Skill: {view.task.snapshot.selectedSkillName??"none"} · Master Prompt: {view.task.snapshot.plan.selectedPromptVersionId??"none"}</p>
   {view.workerError&&<p role="alert" className="text-xs text-danger">Worker error (not a fabricated provider response): {view.workerError}</p>}
   {view.task.warnings.map((w,i)=><p key={i} role="alert" className="text-xs text-danger">{w}</p>)}
   <div className="flex flex-wrap gap-2">
    <Button disabled={working||view.task.stage==="paused"||view.task.stage==="completed"||view.task.stage==="cancelled"} onClick={()=>void control("pause")}>Pause</Button>
    <Button disabled={working||view.task.stage!=="paused"} onClick={()=>void control("resume")}>Resume</Button>
    <Button disabled={working||view.workerRunning||["paused","completed","cancelled","failed","awaiting_approval"].includes(view.task.stage)} onClick={()=>void control("recover")}>Recover safe unfinished MOCK steps</Button>
    <Button disabled={working||view.task.stage==="cancelled"||view.task.stage==="completed"} onClick={()=>void control("cancel")}>Cancel (preserve sources)</Button>
    <Button disabled={!view.execution.assembled} onClick={()=>void openScript()}>Open saved script</Button>
   </div>
   {view.review&&<>
    {quality!==null&&quality<view.policy.reviewTarget&&!view.workerRunning&&
     <p role="alert" className="text-xs text-danger">MOCK reviewer score {quality}/100 is below configured target {view.policy.reviewTarget}/100. Improvement cap may be exhausted; inspect findings before approval.</p>}
    <p className="text-xs">Saved review: {reviewRound?.sections.filter(s=>s.score!==null).length}/{reviewRound?.sections.length} sections · minimum rubric score: {quality??"not scored"}/100 · improvement revisions: {view.review.versions.length-1} · approved: {approved?"yes":"NO"}</p>
    {reviewRound?.sections.map(s=><p className="text-xs" key={s.index}>Section {s.index+1}: {s.score??"pending"} / 100. {s.report?.summary??"Not reviewed"}</p>)}
   </>}
   {view.task.stage==="awaiting_approval"&&!approved&&<div className="space-y-2 border-t border-line pt-2">
    <p className="text-xs font-semibold">Final human approval required — this is a MOCK test candidate, not a verified AI script.</p>
     <p className="text-xs">Open and inspect the latest saved script first. Approval is bound to that exact SHA-256 and a later revision invalidates this consent.</p>
    <label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I inspected this exact saved script and its review evidence.</label>
    <label className="text-xs block">Type APPROVE FINAL SCRIPT<input className={selectStyle+" w-full"} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
    <Button disabled={working||!consent||confirmation!=="APPROVE FINAL SCRIPT"||!canApproveExact(view,previewedDigest)} onClick={()=>void approve()}>Record explicit final approval</Button>
   </div>}
   {script&&<details open><summary className="text-xs">Saved immutable script preview (MOCK)</summary><textarea className={selectStyle+" w-full font-mono"} rows={12} value={script} readOnly/></details>}
   <details><summary className="text-xs">Rust supervisor history ({view.task.events.length})</summary>
    {view.task.events.map((e,i)=><p className="text-xs" key={i}>{i+1}. {e}</p>)}</details>
  </div>}
 </section>;
}
