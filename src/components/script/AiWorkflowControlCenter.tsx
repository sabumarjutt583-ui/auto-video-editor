import {useEffect,useRef,useState} from "react";
import {AutomaticScriptPanel} from "./AutomaticScriptPanel.tsx";
import {invoke} from "@tauri-apps/api/core";
import {Button} from "../ui";
import {accountSummary,chromeOpen,chromeStatus,responseStats,type ChromeProvider,type WorkspaceReport} from "../../lib/script/chrome/api.ts";
import {operatorCanEdit,selectReviewSection} from "../../lib/script/chrome/operator.ts";
import {nextLocalPartToPrepare} from "../../lib/script/chrome/nextPart.ts";
import {pendingPromptKind} from "../../lib/script/chrome/promptRecovery.ts";
import type {LegacyChannelSeed,ScriptStudioPlanV1} from "../../lib/script/studio/types.ts";
import {getStudioPlan} from "../../lib/script/studio/api.ts";
import type {ExecutionState,ExecutionAction,ExecutionRequest,CandidateValidation} from "../../lib/script/execution/types.ts";
import {applyExecution,buildExecutionRequest,getExecution,listExecutions,readExecution,validateCandidate} from "../../lib/script/execution/api.ts";
import type {ReviewAction,ReviewState,Report} from "../../lib/script/review/types.ts";
import {applyReview,buildReviewRequest,getReview,listReviews,newReviewId,newReviewOperation,
 readReview,startReview} from "../../lib/script/review/api.ts";
import type {MockScenario,SupervisorAction,SupervisorTask,SupervisorTransport,TaskRequest,TaskStart} from "../../lib/script/supervisor/types.ts";
import {applyTask,getTask,listTasks,mockText,newSupervisorOperation,newTaskId,startTask,
 supervisorError,taskMessage,taskRequest} from "../../lib/script/supervisor/api.ts";
const cn="w-full border rounded border-line bg-surface p-2 text-xs";
type Metadata={id:string;name:string;connected?:boolean;signingIn?:boolean;lastError?:string;limitedUntil?:number};
interface Props{seed:LegacyChannelSeed}
/** Development-only manual operator. All browser sessions remain user-controlled. */
export function AiWorkflowControlCenter({seed}:Props){
 const [executions,setExecutions]=useState<ExecutionState[]>([]);
 const [tasks,setTasks]=useState<SupervisorTask[]>([]);
 const [chosenExecution,setChosenExecution]=useState("");
 const [writerChoice,setWriterChoice]=useState("");
 const [reviewerChoice,setReviewerChoice]=useState("");
 const [transport,setTransport]=useState<SupervisorTransport>("visible_browser");
 const [selectedPlan,setSelectedPlan]=useState<ScriptStudioPlanV1|null>(null);
 const [active,setActive]=useState<SupervisorTask|null>(null);
 const [execution,setExecution]=useState<ExecutionState|null>(null);
 const [review,setReview]=useState<ReviewState|null>(null);
 const [chromeReport,setChromeReport]=useState<WorkspaceReport|null>(null);
 const [claude,setClaude]=useState<Metadata[]>([]);
 const [chatgpt,setChatgpt]=useState<Metadata[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [prompt,setPrompt]=useState(""),[mock,setMock]=useState(""),[response,setResponse]=useState("");
 const [scenario,setScenario]=useState<MockScenario>("complete");
 const [continuity,setContinuity]=useState(""),[section,setSection]=useState(0),[reportRaw,setReportRaw]=useState("");
 const [goals,setGoals]=useState("Improve the opening hook"),[revisionText,setRevisionText]=useState("");
 const [reviewMode,setReviewMode]=useState<"final"|"single"|"improvement">("final");
 const [confirmation,setConfirmation]=useState(""),[consent,setConsent]=useState(false),[warningsAccepted,setWarningsAccepted]=useState(false);
 const [validated,setValidated]=useState<{executionId:string;revision:number;partIndex:number;result:CandidateValidation}|null>(null);
 const [browserStatusError,setBrowserStatusError]=useState("");
 const taskRetry=useRef<{key:string;request:TaskRequest}|null>(null);
 const startRetry=useRef<{key:string;input:TaskStart}|null>(null);
 const reviewRetry=useRef<{key:string;action:ReviewAction;operationId:string}|null>(null);
 const executionRetry=useRef<{key:string;request:ExecutionRequest}|null>(null);
 const sectionDrafts=useRef<Record<string,string>>({});
 const reviewSelection=useRef<{reviewId:string;round:number;index:number}|null>(null);
 useEffect(()=>{
  let live=true;setActive(null);setExecution(null);setReview(null);setChromeReport(null);setError("");setNotice("");
  setSelectedPlan(null);setValidated(null);setBrowserStatusError("");setWarningsAccepted(false);setConsent(false);setConfirmation("");reviewSelection.current=null;
  taskRetry.current=null;startRetry.current=null;reviewRetry.current=null;
  void Promise.allSettled([listExecutions(seed),listTasks(seed),invoke<Metadata[]>("script_accounts"),invoke<Metadata[]>("chatgpt_accounts")]).then(x=>{
   if(!live)return;
   if(x[0].status==="fulfilled"){setExecutions(x[0].value.executions);setChosenExecution(x[0].value.executions[0]?.executionId??"")}
   else setError(supervisorError(x[0].reason));
   if(x[1].status==="fulfilled")setTasks(x[1].value);else setError(supervisorError(x[1].reason));
   if(x[2].status==="fulfilled")setClaude(x[2].value);else setError("Claude account list unavailable.");
   if(x[3].status==="fulfilled")setChatgpt(x[3].value);else setError("ChatGPT account list unavailable.");
  });return()=>{live=false};
 },[seed.channelId]);
 useEffect(()=>{
  let live=true;const e=executions.find(x=>x.executionId===chosenExecution);
  setSelectedPlan(null);setWriterChoice("");setReviewerChoice("");
  if(e)void getStudioPlan(seed.channelId,e.planId)
   .then(plan=>{if(live)setSelectedPlan(plan)})
   .catch(err=>{if(live)setError("Saved plan could not be loaded: "+supervisorError(err))});
  return()=>{live=false};
 },[seed.channelId,chosenExecution,executions]);
 const partIndex=execution?.completedParts===execution?.totalParts?0:(execution?.completedParts??0)+1;
 const currentPart=partIndex?execution?.parts[partIndex-1]:null;
 const lastRound=review?.rounds.at(-1),currentVersion=review?.versions.at(-1);
 const reviewedSections=lastRound?.sections.filter(s=>s.report&&s.score!==null).length??0;
 const availableAccounts=active?.snapshot.reviewerProvider==="chatgpt"?chatgpt:claude;
 const reviewerOptions=selectedPlan?.reviewerProvider==="chatgpt"?chatgpt:selectedPlan?.reviewerProvider==="claude"?claude:[];
 const canEdit=active?operatorCanEdit(active.stage):false;
 const candidateCurrent=Boolean(validated&&execution&&currentPart&&validated.executionId===execution.executionId&&
  validated.revision===execution.revision&&validated.partIndex===currentPart.index&&
  validated.result.fragmentCount===currentPart.fragments.length);
 async function load(task:SupervisorTask){
  const e=await getExecution(seed,task.snapshot.executionId);
  let rv:ReviewState|null=null;
  if(task.lastReviewId)rv=await getReview(seed,task.lastReviewId);
  if(active?.taskId!==task.taskId){setValidated(null);setWarningsAccepted(false);setConsent(false);setConfirmation("")}
  setActive(task);setExecution(e);setReview(rv);
  if(task.snapshot.transport==="visible_browser"){
   try{setChromeReport(await chromeStatus(seed,task.taskId));setBrowserStatusError("")}
   catch(err){setChromeReport(null);setBrowserStatusError("Chrome status unavailable; script data remains accessible: "+supervisorError(err))}
  }else{setChromeReport(null);setBrowserStatusError("")}
  if(rv){
   const round=rv.rounds.at(-1);
   const selected=selectReviewSection(reviewSelection.current,rv.reviewId,round?.index??0,round?.sections.length??0);
   reviewSelection.current={reviewId:rv.reviewId,round:round?.index??0,index:selected};
   setSection(selected);setReportRaw(sectionDrafts.current[rv.reviewId+"/"+round?.index+"/"+selected]??"");
   if(round?.sections.length)setPrompt(await readReview(seed,rv.reviewId,"prompt",selected));else setPrompt("");
  }else if(e.completedParts<e.totalParts){
   reviewSelection.current=null;
   const part=e.parts[e.completedParts];
   const kind=part?pendingPromptKind(part):null;
   setPrompt(kind?await readExecution(seed,e.executionId,kind,e.completedParts+1):"");
  }else{reviewSelection.current=null;setPrompt("")}
 }
 async function reload(){
  if(busy)return;setBusy(true);setError("");
  try{
   const [ex,ts,c,g]=await Promise.all([listExecutions(seed),listTasks(seed),
    invoke<Metadata[]>("script_accounts"),invoke<Metadata[]>("chatgpt_accounts")]);
   setExecutions(ex.executions);setTasks(ts);setClaude(c);setChatgpt(g);
   if(active){
    const refreshed=ts.find(t=>t.taskId===active.taskId);
    if(refreshed)await load(refreshed);
   }
   setNotice("Recovered verified local checkpoints and current account metadata. Browser process status is observable only for this app session.");
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function create(){
  if(busy||!chosenExecution)return;
  setBusy(true);setError("");setNotice("");
  try{
   const execution=await getExecution(seed,chosenExecution);
   const plan:ScriptStudioPlanV1=await getStudioPlan(seed.channelId,execution.planId);
   setSelectedPlan(plan);
   const key=JSON.stringify([chosenExecution,transport,writerChoice,reviewerChoice]);
   if(startRetry.current?.key!==key){
    const skill=plan.configSnapshot.skills.find(x=>x.skillId===plan.selectedSkillId);
    startRetry.current={key,input:{
     channelId:seed.channelId,taskId:newTaskId(),executionId:chosenExecution,
     operationId:newSupervisorOperation(),transport,
     writerAccountId:writerChoice||plan.claudeAccountId,reviewerAccountId:reviewerChoice||plan.reviewerAccountId,
     skillStatus:skill?.status??"not_configured"
    }};
   }
   const task=await startTask(seed,startRetry.current.input);
   startRetry.current=null;await load(task);setTasks(await listTasks(seed));
   setNotice("Supervisor created from immutable plan and execution. No browser or provider request was started.");
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function applySupervisor(action:SupervisorAction){
  if(!active||busy)return;
  const key=JSON.stringify([active.taskId,active.revision,action]);
  if(taskRetry.current?.key!==key)taskRetry.current={key,request:taskRequest(active,action)};
  setBusy(true);setError("");
  try{
   const t=await applyTask(seed,taskRetry.current.request);taskRetry.current=null;
   await load(t);setTasks(await listTasks(seed));setNotice(taskMessage(t));
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function applyExecutionAction(action:ExecutionAction){
  if(!active||!execution||busy)return;
  if(!operatorCanEdit(active.stage)){setError("Task is paused or terminal. Resume before editing saved script data.");return}
  if(action.kind==="commit_part"&&
   !(validated&&validated.executionId===execution.executionId&&validated.partIndex===action.partIndex&&
     validated.revision===execution.revision&&validated.result.fragmentCount===execution.parts[action.partIndex-1]?.fragments.length)){
   setError("Revalidate the current part before committing. Old warning acknowledgments cannot be reused.");return;
  }
  setBusy(true);setError("");
  try{
   const key=JSON.stringify([execution.executionId,execution.revision,action]);
   if(executionRetry.current?.key!==key)executionRetry.current={key,request:buildExecutionRequest(execution,action)};
   if(action.kind==="import_fragment"){
    const part=execution.parts[action.partIndex-1];
    if(part?.fragments.length){
     for(let index=0;index<part.fragments.length;index++){
      if(await readExecution(seed,execution.executionId,"fragment",action.partIndex,index)===action.text){
       throw Error("Exact duplicate response already saved as an immutable fragment. Nothing was imported.");
      }
     }
    }
   }
   let next=await applyExecution(seed,executionRetry.current.request);
   executionRetry.current=null;
   let followUp="";
   // Only create the NEXT LOCAL prompt once the prior checkpoint is safely saved.
   // A required continuity note is never fabricated. This never sends any browser message.
   if(action.kind==="commit_part"||action.kind==="save_continuity"){
    const nextPart=nextLocalPartToPrepare(next,active.snapshot.plan);
    if(nextPart!==null){
     try{
      next=await applyExecution(seed,buildExecutionRequest(next,{kind:"prepare_part",partIndex:nextPart,extraInstructions:""}));
      followUp=" Part "+nextPart+" prompt prepared locally, not sent.";
     }catch(e){
      followUp=" Prior checkpoint saved; next part requires manual attention: "+supervisorError(e);
     }
    }else if(next.completedParts<next.totalParts){
     followUp=" Save required continuity notes or prepare the next local prompt manually.";
    }
   }
   const t=await applyTask(seed,taskRequest(active,{kind:"sync_execution"}));
   setExecution(next);await load(t);setTasks(await listTasks(seed));
   if(action.kind==="prepare_part"||action.kind==="prepare_continuation"){
    setPrompt(await readExecution(seed,next.executionId,action.kind==="prepare_part"?"prompt":"continuation",action.partIndex));
   }
   if(action.kind==="import_fragment")setResponse("");
   if(action.kind==="save_continuity")setContinuity("");
   setValidated(null);setWarningsAccepted(false);
   setNotice("Verified saved execution checkpoint "+next.revision+". No provider submission."+followUp);
  }catch(e){setError(supervisorError(e)+" Refresh saved records before retrying.")}
  finally{setBusy(false)}
 }
 async function startReviewTask(){
  if(!execution?.assembled||!active||busy)return;
  if(!operatorCanEdit(active.stage)){setError("Resume task before starting review.");return}
  setBusy(true);setError("");
  try{
   const found=(await listReviews(seed)).reviews.find(r=>r.executionId===execution.executionId&&r.partIndex===null);
   const rv=found??await startReview(seed,{channelId:seed.channelId,executionId:execution.executionId,
    partIndex:null,reviewId:newReviewId(),operationId:newReviewOperation()});
   const next=await applyTask(seed,taskRequest(active,{kind:"sync_review",reviewId:rv.reviewId}));
   await load(next);setTasks(await listTasks(seed));
   setNotice("Exact immutable review session attached; manual review still required.");
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function reviewAction(action:ReviewAction){
  if(!review||!active||busy)return;
  if(!operatorCanEdit(active.stage)){setError("Resume task before importing, revising or approving.");return}
  const key=JSON.stringify([review.reviewId,review.revision,action]);
  if(reviewRetry.current?.key!==key)reviewRetry.current={key,action,operationId:newReviewOperation()};
  setBusy(true);setError("");
  try{
   const saved=await applyReview(seed,buildReviewRequest(review,action,reviewRetry.current.operationId));
   reviewRetry.current=null;
   const next=await applyTask(seed,taskRequest(active,{kind:"sync_review",reviewId:saved.reviewId}));
   await load(next);
   setTasks(await listTasks(seed));
   if(action.kind==="import_response"){
    delete sectionDrafts.current[saved.reviewId+"/"+saved.rounds.at(-1)?.index+"/"+section];
    setReportRaw("");
   }
   if(action.kind==="import_revision")setRevisionText("");
   setConsent(false);setConfirmation("");
   setNotice("Review checkpoint verified. Manual provenance, not verified Claude/ChatGPT output.");
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function navigateSection(index:number){
  if(!review)return;setBusy(true);setError("");
  try{
   sectionDrafts.current[review.reviewId+"/"+review.rounds.at(-1)?.index+"/"+section]=reportRaw;
   setPrompt(await readReview(seed,review.reviewId,"prompt",index));
   reviewSelection.current={reviewId:review.reviewId,round:review.rounds.at(-1)?.index??0,index};
   setSection(index);setReportRaw(sectionDrafts.current[review.reviewId+"/"+review.rounds.at(-1)?.index+"/"+index]??"");
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function refreshChrome(){
  if(!active||active.snapshot.transport!=="visible_browser"||busy)return;
  setBusy(true);setError("");
  try{setChromeReport(await chromeStatus(seed,active.taskId));setNotice("Browser process state checked; site authentication is not verified.");}
  catch(e){setError(supervisorError(e))}finally{setBusy(false)}
 }
 async function openBrowser(provider:ChromeProvider,role:"writer"|"reviewer"){
  if(!active||busy||active.snapshot.transport!=="visible_browser")return;
  const id=role==="writer"?active.snapshot.writerAccountId:active.snapshot.reviewerAccountId;
  if(!id){setError("Missing selected saved account in immutable task snapshot.");return}
  if(role==="writer"&&provider!=="claude"||role==="reviewer"&&active.snapshot.reviewerProvider!==provider){
   setError("Provider does not match selected channel task.");return;
  }
  setBusy(true);setError("");
  try{
   const starting=await applyTask(seed,taskRequest(active,{kind:"mark_browser_opening"}));
   setActive(starting);
   // Rust verifies saved channel, task, provider and selected account before any process launch.
   const report=await chromeOpen(seed,starting.taskId,provider,id);
   const latest=await applyTask(seed,taskRequest(starting,{kind:"mark_user_handoff"}));
   await load(latest);setChromeReport(report);setTasks(await listTasks(seed));
   setNotice((report.lastLaunchNotice??"Browser request returned.")+" Process: "+(report.lastLaunchOutcome??"unknown")+". Manual website interaction and login remain unverified.");
  }catch(e){
   try{setChromeReport(await chromeStatus(seed,active.taskId));}catch{/* keep original launch error */}
   setError(supervisorError(e)+" Inspect Chrome manually if this profile is already open. No script data changed.");
  }finally{setBusy(false)}
 }
 async function userSignIn(provider:ChromeProvider,role:"writer"|"reviewer"){
  if(!active||busy)return;
  const id=role==="writer"?active.snapshot.writerAccountId:active.snapshot.reviewerAccountId;
  if(!id||role==="writer"&&provider!=="claude"||role==="reviewer"&&active.snapshot.reviewerProvider!==provider){
   setError("Saved account and provider must match immutable task.");return;
  }
  setBusy(true);setError("");
  try{
   const awaiting=await applyTask(seed,taskRequest(active,{kind:"mark_login_required"}));
   setActive(awaiting);
   await invoke(provider==="claude"?"script_account_sign_in":"chatgpt_account_sign_in",{id});
   const [c,g]=await Promise.all([invoke<Metadata[]>("script_accounts"),invoke<Metadata[]>("chatgpt_accounts")]);
   setClaude(c);setChatgpt(g);await load(await getTask(seed,active.taskId));
   setNotice("Manual sign-in flow returned. Previously reported account connection is not proof of a current website login or message.");
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function pasteResponse(){
  try{
   const text=await navigator.clipboard.readText();
   if(!text){setError("Clipboard is empty. No response was imported.");return}
   setResponse(text);setNotice("User-triggered clipboard paste loaded exact text into a local draft. Review before committing.");
  }catch(e){setError(supervisorError(e)+". Paste manually into the response field instead.")}
 }
 async function pasteReview(){
  try{
   const text=await navigator.clipboard.readText();
   if(!text){setError("Clipboard is empty. No review imported.");return}
   setReportRaw(text);setNotice("Review text pasted locally. No provider origin or scores have yet been verified.");
  }catch(e){setError(supervisorError(e)+". Paste manually into the review field instead.")}
 }
 async function generateMock(){
  if(!active||!partIndex||busy)return;
  setBusy(true);setError("");
  try{
   const fixture=await mockText(seed,active.taskId,partIndex,scenario);
   setMock(fixture.text??"");
   if(fixture.text)setResponse(fixture.text);
   setNotice(fixture.status+": "+(fixture.issue??"Deterministic LOCAL test text only. Must be imported into execution explicitly."));
  }catch(e){setError(supervisorError(e))}
  finally{setBusy(false)}
 }
 async function copyPrompt(){
  try{await navigator.clipboard.writeText(prompt);setNotice("Prompt copied locally, NOT submitted to provider.");}
  catch(e){setError(supervisorError(e)+". Select and copy the prompt manually.")}
 }
 if(!import.meta.env.DEV)return null;
 return <section className="rounded border border-dashed border-line p-3 space-y-3" aria-label="AI Workflow Control Center">
  <h4 className="font-semibold">Script Production Studio · Phase 03M Development Only</h4>
  <AutomaticScriptPanel seed={seed}/>
  <h5 className="font-semibold text-sm">Phase 03L manual visible Chrome fallback</h5>
  <p className="text-xs text-muted">One dashboard for user-assisted writing, local imports, review and approval. Consumer-site submission, extraction, live login verification and API generation are NOT supported. No media handoff.</p>
  <ol className="text-xs grid grid-cols-2 lg:grid-cols-5 gap-2 list-decimal list-inside">
   {["Select channel","Choose saved plan","Resolve accounts","Open visible Chrome","Prepare/copy prompt","Import actual response","Continue/assemble","Review sections","Improve/re-review","Explicit approval"].map((name,i)=>
    <li key={name} className="rounded border border-line p-2">{name}{i===9&&active?.approvalDigest?" · Approved":""}</li>)}
  </ol>
  {error&&<p role="alert" className="text-xs text-danger">{error}</p>}
  {notice&&<p role="status" className="text-xs">{notice}</p>}
  <div className="flex flex-wrap gap-2 items-end">
   <label className="text-xs flex-1">Saved execution
    <select className={cn} value={chosenExecution} onChange={e=>setChosenExecution(e.target.value)}>
     {executions.map(e=><option key={e.executionId} value={e.executionId}>{e.executionId} · {e.completedParts}/{e.totalParts} · {e.planId}</option>)}
    </select>
   </label>
   <label className="text-xs">Transport
    <select className={cn} value={transport} onChange={e=>setTransport(e.target.value as SupervisorTransport)}>
     <option value="visible_browser">Visible browser — user action</option>
     <option value="local_mock">Deterministic local mock</option>
    </select>
   </label>
   <Button disabled={busy||!chosenExecution||!selectedPlan} onClick={()=>void create()}>Create supervised task</Button>
   <label className="text-xs">Explicit writer fallback (must be allowed by saved plan)
    <select className={cn} value={writerChoice} onChange={e=>setWriterChoice(e.target.value)}>
     <option value="">Use saved plan's Claude account</option>
     {claude.map(a=><option value={a.id} key={a.id}>{a.name} ({a.id})</option>)}
    </select>
   </label>
   <label className="text-xs">Explicit {selectedPlan?.reviewerProvider??"saved"} reviewer fallback (saved policy enforced in Rust)
    <select className={cn} value={reviewerChoice} onChange={e=>setReviewerChoice(e.target.value)}>
     <option value="">Use saved plan's reviewer account</option>
     {reviewerOptions.map(a=><option value={a.id} key={a.id}>{selectedPlan?.reviewerProvider}: {a.name} ({a.id})</option>)}
    </select>
   </label>
   <Button disabled={busy} onClick={()=>void reload()}>Reload all from disk</Button>
  </div>
  <div className="max-h-36 overflow-y-auto space-y-1">
   {tasks.map(task=><div key={task.taskId} className="flex flex-wrap gap-2 items-center text-xs">
    <span>{task.taskId} · {task.stage} · {task.completedParts}/{task.totalParts} · {task.snapshot.transport}</span>
    <Button disabled={busy} onClick={()=>void (async()=>{setBusy(true);try{await load(await getTask(seed,task.taskId));setNotice("Reopened source-owned task history.");}catch(e){setError(supervisorError(e))}finally{setBusy(false)}})()}>Inspect/resume</Button>
   </div>)}
  </div>
  {active&&execution&&<div className="space-y-3 border-t border-line pt-3">
   <p className="text-xs break-all">Owner {active.channelId} · Task {active.taskId} · checkpoint {active.revision} · execution {active.snapshot.executionId}</p>
   <p className="text-xs break-all">Immutable plan {active.snapshot.plan.planId} · plan digest {active.snapshot.planSha256} · stage <strong>{active.stage}</strong></p>
   <p className="text-sm font-semibold">{active.snapshot.plan.title}</p>
   <p className="text-xs">{active.snapshot.plan.topic} · {active.snapshot.plan.mode==="single"?"Single Script":"Multi-Part"} · {active.snapshot.plan.totalWords} target words · {active.totalParts} parts · {active.snapshot.plan.language}</p>
   <p className="text-xs">Audience: {active.snapshot.plan.configSnapshot.writing.targetAudience} · Tone: {active.snapshot.plan.configSnapshot.writing.narrationTone} · Style: {active.snapshot.plan.configSnapshot.writing.writingStyle}</p>
   <p className="text-xs">{taskMessage(active)}</p>
   <details className="border border-line rounded p-2" open>
    <summary className="text-sm font-semibold">Channel account, Skill and transport capabilities</summary>
    <p className="text-xs">Writer: Claude {active.snapshot.writerAccountId??"NOT SELECTED"} ({claude.find(x=>x.id===active.snapshot.writerAccountId)?.name??"missing account"}) ·
      reviewer: {active.snapshot.plan.reviewerProvider} {active.snapshot.reviewerAccountId??"NOT SELECTED"} ({availableAccounts.find(x=>x.id===active.snapshot.reviewerAccountId)?.name??"missing account"})</p>
    <p className="text-xs">Writing mode {active.snapshot.plan.writingMode} · immutable master prompt {active.snapshot.plan.selectedPromptVersionId??"none"} · Skill {active.snapshot.selectedSkillName??"none"} ({active.snapshot.skillStatus}). Skill activation has NOT been remotely verified.</p>
    {active.snapshot.selectedSkillId&&<p className="text-xs">Skill's registered Claude account {active.snapshot.plan.configSnapshot.skills.find(x=>x.skillId===active.snapshot.selectedSkillId)?.claudeAccountId??"MISSING"} · selected writer {active.snapshot.writerAccountId??"MISSING"}</p>}
    <p className="text-xs">Rubric total {active.snapshot.plan.configSnapshot.rubric.reduce((n,c)=>n+c.points,0)} ·
     {active.snapshot.plan.configSnapshot.rubric.map(c=>c.label+" "+c.points).join(" · ")}</p>
    <p className="text-xs">Capabilities: {active.snapshot.capabilities.join(", ")}</p>
    <p className="text-xs">Writer session: {claude.find(x=>x.id===active.snapshot.writerAccountId)?.connected?"connected (not proof of provider response)":
      claude.find(x=>x.id===active.snapshot.writerAccountId)?.signingIn?"user sign-in pending":"not connected / not verified"}.
      Reviewer session: {availableAccounts.find(x=>x.id===active.snapshot.reviewerAccountId)?.connected?"connected":"not connected / not verified"}.</p>
    {claude.find(x=>x.id===active.snapshot.writerAccountId)?.lastError&&<p role="alert" className="text-xs text-danger">Writer account: {claude.find(x=>x.id===active.snapshot.writerAccountId)?.lastError}</p>}
    <p className="text-xs">Transport: {active.snapshot.transport}; no credential material is written to this supervisor.</p>
    <p className="text-xs">Master Prompt: {active.snapshot.plan.configSnapshot.promptVersions.find(v=>v.versionId===active.snapshot.plan.selectedPromptVersionId)?.versionId??"Not selected"} · Writing instruction mode: {active.snapshot.plan.writingMode} · Skill installation: {active.snapshot.skillStatus==="user_confirmed_installed"?"USER-CONFIRMED only (not remotely verified)":active.snapshot.skillStatus}</p>
   </details>
   <div className="flex flex-wrap gap-2">
    <Button disabled={busy||active.stage==="paused"||active.stage==="cancelled"||active.stage==="completed"} onClick={()=>void applySupervisor({kind:"pause"})}>Pause</Button>
    <Button disabled={busy||active.stage!=="paused"} onClick={()=>void applySupervisor({kind:"resume"})}>Resume</Button>
    <Button disabled={busy||active.stage==="cancelled"||active.stage==="completed"} onClick={()=>void applySupervisor({kind:"cancel"})}>Cancel task (preserve sources)</Button>
    <Button disabled={busy} onClick={()=>void applySupervisor({kind:"sync_execution"})}>Verify execution progress</Button>
    {active.lastReviewId&&<Button disabled={busy} onClick={()=>void applySupervisor({kind:"sync_review",reviewId:active.lastReviewId!})}>Verify review/approval</Button>}
   </div>
   {active.snapshot.transport==="visible_browser"&&<div className="rounded border border-line p-3 space-y-2">
    <h5 className="font-semibold text-sm">Chrome Workspace · Account-specific browser profiles</h5>
    <p className="text-xs">Selected writer {active.snapshot.writerAccountId??"missing"} (Claude) · selected reviewer {active.snapshot.reviewerAccountId??"none"} ({active.snapshot.reviewerProvider})</p>
    <p className="text-xs">{chromeReport?.browserAvailable?"Found: "+chromeReport.browserName:"Browser unavailable or not checked"} · {chromeReport?.browserDiagnostic??"Choose a task to inspect the local browser."}</p>
    {chromeReport?.accounts.map(a=><div key={a.profileIdentity} className="rounded bg-surface border border-line p-2 space-y-1">
     <p className="text-xs font-semibold">{a.displayName} · {a.provider.toUpperCase()} · account {a.accountId} · profile {a.profileIdentity}</p>
     <p className="text-xs">Saved account {a.savedAccountPresent?"present":"MISSING"} · process {a.processState.replace(/_/g," ")} · previous connection report {a.lastReportedConnected?"connected":"not connected"} · sign-in {a.signingIn?"in progress":"unverified"}.</p>
     <p className="text-xs text-muted">{accountSummary(a)}</p>
     {a.lastLaunchError&&<p className="text-xs text-danger">{a.lastLaunchError}</p>}
     {a.reportedAccountError&&<p className="text-xs text-danger">Account manager: {a.reportedAccountError}</p>}
    </div>)}
    {browserStatusError&&<p role="alert" className="text-xs text-danger">{browserStatusError}</p>}
    {chromeReport?.lastLaunchOutcome&&<p className="text-xs">Last open request: {chromeReport.lastLaunchOutcome.replace(/_/g," ")} · {chromeReport.lastLaunchNotice}</p>}
    <p className="text-xs text-muted">{chromeReport?.warning??"Window status is not proof of website authentication."}</p>
    <div className="flex flex-wrap gap-2">
     <Button disabled={busy||!active.snapshot.writerAccountId||!chromeReport?.browserAvailable||active.stage==="paused"||active.stage==="cancelled"} onClick={()=>void openBrowser("claude","writer")}>Open writer Claude in Chrome</Button>
     <Button disabled={busy||!active.snapshot.writerAccountId} onClick={()=>void userSignIn("claude","writer")}>Claude manual sign-in</Button>
     {active.snapshot.reviewerProvider!=="none"&&<Button disabled={busy||!active.snapshot.reviewerAccountId||!chromeReport?.browserAvailable||active.stage==="paused"||active.stage==="cancelled"} onClick={()=>void openBrowser(active.snapshot.reviewerProvider as ChromeProvider,"reviewer")}>Open reviewer {active.snapshot.reviewerProvider}</Button>}
     {active.snapshot.reviewerProvider!=="none"&&<Button disabled={busy||!active.snapshot.reviewerAccountId} onClick={()=>void userSignIn(active.snapshot.reviewerProvider as ChromeProvider,"reviewer")}>Reviewer manual sign-in</Button>}
     <Button disabled={busy} onClick={()=>void refreshChrome()}>Refresh process status</Button>
    </div>
    <p className="text-xs">If Chrome is already running, switch to the existing window manually. No focus/close control is claimed. Close windows yourself; do not disconnect accounts to close them.</p>
    <Button disabled={busy} onClick={()=>void applySupervisor({kind:"mark_submission_uncertain"})}>Mark manually submitted prompt uncertain</Button>
    <Button disabled={busy||!prompt} onClick={()=>void applySupervisor({kind:"mark_awaiting_response"})}>I submitted manually · await response</Button>
   </div>}
   <div className="border border-line p-2 rounded space-y-2">
    <p className="text-sm font-semibold">Script progress · {execution.completedParts}/{execution.totalParts} parts · {execution.status}</p>
    <p className="text-xs">Saved outline {execution.outlineVersions.length} · Bible {execution.bibleVersions.length} · user-written continuity notes {execution.continuityNotes.length}</p>
    {currentPart&&<>
     <p className="text-xs">Part {currentPart.index}: {currentPart.title||"Untitled"} · {currentPart.objective||"No part objective"} · target {currentPart.targetWords} words · fragments {currentPart.fragments.length}</p>
     <div className="flex flex-wrap gap-2">
      <Button disabled={busy||!canEdit||Boolean(currentPart.prepared)} onClick={()=>void applyExecutionAction({kind:"prepare_part",partIndex:currentPart.index,extraInstructions:""})}>Prepare exact part prompt</Button>
      {currentPart.fragments.length>0&&<Button disabled={busy} onClick={()=>void applyExecutionAction({kind:"prepare_continuation",partIndex:currentPart.index,extraInstructions:""})}>Prepare continuation</Button>}
     </div>
     {currentPart.prepared&&<Button disabled={busy} onClick={()=>void readExecution(seed,execution.executionId,"prompt",currentPart.index).then(setPrompt).catch(e=>setError(supervisorError(e)))}>Read original part prompt (reference only)</Button>}
     {currentPart.fragments.length>0&&!pendingPromptKind(currentPart)&&<p className="text-xs">Latest fragment is saved. Prepare a new continuation prompt if Claude has not completed this part. No old prompt will be automatically reused.</p>}
     {active.snapshot.transport==="local_mock"&&<div className="flex flex-wrap gap-2 items-end">
      <label className="text-xs">Mock response scenario
       <select className={cn} value={scenario} onChange={e=>setScenario(e.target.value as MockScenario)}>
        {(["complete","delayed","partial","provider_failure","connection_lost","submission_uncertain","too_large","invalid_review"] as MockScenario[]).map(v=><option key={v}>{v}</option>)}
       </select>
      </label>
      <Button disabled={busy} onClick={()=>void generateMock()}>Simulate local mock</Button>
     </div>}
     {mock&&<p className="text-xs">Mock returned {mock.length} characters. This text was NOT automatically saved or sent.</p>}
     {currentPart.prepared&&<label className="text-xs block">Paste actual AI response (preserve Unicode, whitespace and CRLF; never auto-submitted)
      <textarea className={cn} rows={5} value={response} onChange={e=>setResponse(e.target.value)}/>
      <span className="text-xs">Draft only: {responseStats(response).words} words · {responseStats(response).bytes} UTF-8 bytes · {responseStats(response).lines} lines</span>
     </label>}
     {currentPart.prepared&&<div className="flex gap-2 flex-wrap"><Button disabled={busy} onClick={()=>void pasteResponse()}>Paste from clipboard (user-triggered)</Button><Button disabled={busy||!response} onClick={()=>setResponse("")}>Clear uncommitted draft</Button></div>}
     {response&&currentPart.prepared&&<details className="border border-line p-2"><summary className="text-xs">Exact raw response preview (not yet committed)</summary><pre className="text-xs whitespace-pre-wrap break-words">{response}</pre></details>}
     <Button disabled={busy||!canEdit||!currentPart.prepared||!response.trim()} onClick={()=>void applyExecutionAction({kind:"import_fragment",partIndex:currentPart.index,text:response})}>Import response into Rust execution</Button>
     {currentPart.fragments.length>0&&<>
      <p className="text-xs">Saved immutable response fragments: {currentPart.fragments.map((f,i)=>"#"+(i+1)+" "+f.sha256.slice(0,14)).join(" · ")}. Original imports cannot be overwritten.</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!canEdit||!candidateCurrent||!validated?.result.findings.length} checked={warningsAccepted} onChange={e=>setWarningsAccepted(e.target.checked)}/> I explicitly accept this exact candidate's technical warnings.</label>
       {candidateCurrent&&validated&&<div className="text-xs space-y-1">
        <p>Validated: {validated.result.actualWordEstimate} estimated words / {validated.result.targetWords} target · {validated.result.fragmentCount} fragments · SHA-256 {validated.result.contentSha256}</p>
        {validated.result.findings.length===0?<p>No technical warnings; editorial review is still required.</p>:validated.result.findings.map((f,i)=><p key={i} role="alert">{f}</p>)}
       </div>}
       <Button disabled={busy||!canEdit} onClick={()=>void (async()=>{
        setError("");setValidated(null);setWarningsAccepted(false);
        try{
         const result=await validateCandidate(seed,execution.executionId,currentPart.index);
         setValidated({executionId:execution.executionId,revision:execution.revision,partIndex:currentPart.index,result});
         setNotice(result.findings.length?"Review and accept the displayed warnings before committing.":"Candidate validated with no technical warnings.");
        }catch(err){setError(supervisorError(err))}
       })()}>Validate exact candidate</Button>
       <Button disabled={busy||!canEdit||!candidateCurrent||Boolean(validated?.result.findings.length&&!warningsAccepted)}
        onClick={()=>void applyExecutionAction({kind:"commit_part",partIndex:currentPart.index,acceptWarnings:warningsAccepted})}>Commit validated part</Button>
     </>}
    </>}
    {execution.status==="active"&&execution.completedParts>0&&<label className="block text-xs">User-authored note for latest completed part {execution.completedParts}
      <textarea className={cn} value={continuity} rows={2} onChange={e=>setContinuity(e.target.value)}/>
      <Button disabled={busy||!canEdit||!continuity.trim()} onClick={()=>void applyExecutionAction({kind:"save_continuity",afterPart:execution.completedParts,text:continuity})}>Save immutable continuity note</Button>
    </label>}
    {execution.completedParts===execution.totalParts&&execution.status==="active"&&<Button disabled={busy||!canEdit} onClick={()=>void applyExecutionAction({kind:"assemble"})}>Assemble immutable final script</Button>}
   </div>
   {prompt&&<div className="space-y-1">
    <p className="text-xs">Exact saved local prompt · NOT submitted</p>
    <textarea className={cn} value={prompt} rows={7} readOnly/>
    <Button disabled={busy} onClick={()=>void copyPrompt()}>Copy prompt for manual use</Button>
   </div>}
   {execution.assembled&&<div className="border border-line p-2 rounded space-y-2">
    <p className="text-sm font-semibold">Review and explicit approval</p>
    {!review&&<Button disabled={busy} onClick={()=>void startReviewTask()}>Create / attach existing final review</Button>}
    {review&&lastRound&&currentVersion&&<>
     <p className="text-xs">Review {review.reviewId} · Round {lastRound.index} · version {lastRound.versionIndex} ·
       {reviewedSections}/{lastRound.sections.length} manually reviewed sections (NOT a holistic score) ·
       {review.approvals.length} historical approvals</p>
     <p className="text-xs break-all">Current exact script SHA-256 {currentVersion.text.sha256}</p>
     <div className="flex gap-1 flex-wrap">
      {lastRound.sections.map(s=><Button disabled={busy} key={s.index} onClick={()=>void navigateSection(s.index)}>
       Section {s.index+1} · {s.score===null?"unscored":s.score+"/100"}</Button>)}
     </div>
     {lastRound.sections[section]&&!lastRound.sections[section].raw&&<label className="text-xs block">Paste original manual / mock reviewer JSON (all saved rubric keys)
      <textarea className={cn} rows={6} value={reportRaw} onChange={e=>{
       setReportRaw(e.target.value);
       sectionDrafts.current[review.reviewId+"/"+lastRound.index+"/"+section]=e.target.value;
      }}/>
      <div className="flex gap-2 flex-wrap"><Button disabled={busy} onClick={()=>void pasteReview()}>Paste review from clipboard</Button>
      <Button disabled={busy||!canEdit||!reportRaw.trim()} onClick={()=>void reviewAction({kind:"import_response",sectionIndex:section,raw:reportRaw})}>Import exact reviewer response</Button></div>
     </label>}
     {lastRound.sections[section]?.validationIssues.length>0&&<div>
      <p className="text-xs text-danger">{lastRound.sections[section].validationIssues.join(" | ")}</p>
      <label className="block text-xs">Explicit corrected JSON (raw import retained)
       <textarea className={cn} rows={5} value={reportRaw} onChange={e=>setReportRaw(e.target.value)}/>
      </label>
      <Button disabled={busy} onClick={()=>{try{
       const report=JSON.parse(reportRaw) as Report;
       void reviewAction({kind:"correct_response",sectionIndex:section,report});
      }catch{setError("Correction must be valid JSON.")}}}>Validate and save corrected report</Button>
     </div>}
     {lastRound.sections[section]?.report&&<div className="space-y-1 text-xs">
      <p>Section {section+1} score: {lastRound.sections[section].score}/100 · {lastRound.sections[section].report?.summary}</p>
      {lastRound.sections[section].report?.scores.map(c=><p key={c.key}>{review.policy.rubric.find(x=>x.key===c.key)?.label??c.key}: {c.points}</p>)}
      {lastRound.sections[section].report?.findings.map((f,i)=><p key={i}>{f.severity}: {f.summary} · {f.recommendation}</p>)}
     </div>}
     <label className="block text-xs">Improvement goals, one per line
      <textarea className={cn} rows={2} value={goals} onChange={e=>setGoals(e.target.value)}/>
     </label>
     <Button disabled={busy||reviewedSections!==lastRound.sections.length||Boolean(currentVersion.improvementPrompt)}
      onClick={()=>void reviewAction({kind:"prepare_improvement",goals:goals.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)})}>Prepare immutable improvement request</Button>
     {currentVersion.improvementPrompt&&<Button disabled={busy} onClick={()=>void readReview(seed,review.reviewId,"improvement",0).then(setPrompt).catch(e=>setError(supervisorError(e)))}>View/copy saved improvement prompt</Button>}
     {currentVersion.improvementPrompt&&<label className="block text-xs">Paste manually improved script (new immutable version)
      <textarea className={cn} rows={5} value={revisionText} onChange={e=>setRevisionText(e.target.value)}/>
      <Button disabled={busy||!canEdit||!revisionText.trim()} onClick={()=>void reviewAction({kind:"import_revision",text:revisionText})}>Save revised version</Button>
     </label>}
     <label className="text-xs">Re-review mode
      <select className={cn} value={reviewMode} onChange={e=>setReviewMode(e.target.value as typeof reviewMode)}>
       <option value="final">Final</option><option value="single">Single script</option><option value="improvement">Improvement</option>
      </select>
     </label>
     <Button disabled={busy||(lastRound.versionIndex===currentVersion.index&&reviewedSections!==lastRound.sections.length)}
      onClick={()=>void reviewAction({kind:"prepare_review",mode:reviewMode})}>Prepare exact new version-bound review</Button>
     <p className="text-xs">Approval: {active.approvalDigest?"Rust-verified current approval":"Not approved"}. Only Rust-owned final review may approve.</p>
     <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I manually reviewed the exact current script and all required sections.</label>
     <label className="text-xs block">Type APPROVE FINAL SCRIPT<input className={cn} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
     <Button disabled={busy||!canEdit||!consent||confirmation!=="APPROVE FINAL SCRIPT"||lastRound.versionIndex!==currentVersion.index||reviewedSections!==lastRound.sections.length}
      onClick={()=>void reviewAction({kind:"approve",confirmation})}>Request Rust-persisted final approval</Button>
    </>}
   </div>}
   <details className="border border-line rounded p-2">
    <summary className="text-xs font-semibold">Immutable local supervisor event history ({active.events.length})</summary>
    {active.events.map((event,i)=><p className="text-xs" key={i}>{i}: {event}</p>)}
   </details>
  </div>}
 </section>;
}
