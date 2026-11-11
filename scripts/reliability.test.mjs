import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { create } from 'zustand';
import { runPipeline } from '../src/lib/pipeline/runner.ts';
import { stageDone, pictureScenes } from '../src/lib/pipeline/plan.ts';
import { assertProjectAvailable, assertProjectDeletable, acquireProject, isProjectActive } from '../src/lib/pipeline/activity.ts';
import { invalidateProject } from '../src/lib/pipeline/invalidate.ts';
import { defaultProfile, profileProblems, readProfiles } from '../src/lib/pipeline/profile.ts';
import * as queueLogic from '../src/lib/pipeline/queue.ts';
import { initialView, reduceView, withDetail } from '../src/lib/pipeline/view.ts';
import { STAGE_IDS, NO_PAUSES } from '../src/lib/pipeline/stages.ts';
import { recordFromProject, scriptRecordFor } from '../src/lib/script/step0.ts';
import { captureProviders, voiceProviderMismatch } from '../src/lib/pipeline/providers.ts';
import { readEditor } from '../src/lib/editor/model.ts';

const errorOf = e => ({message:e.message ?? String(e),details:e.details ?? '',code:e.code});
const tick = () => new Promise(r=>setImmediate(r));
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
const baseProject = (patch={}) => ({id:'A',name:'Video',script:'Original script',voiceLocked:false,voicePath:null,voiceOriginalPath:null,voiceDuration:0,words:[],scenes:[],mediaMap:{},bibleLocked:false,editor:null,renderedAt:null,characterBible:[],locationBible:[],...patch});

function loadStore(file, name, deps) {
  const code=stripTypeScriptTypes(readFileSync(new URL(file,import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
  return new Function(...Object.keys(deps),code+`;return ${name};`)(...Object.values(deps));
}

function pipelineStore(projects, overrides={}) {
  return loadStore('../src/store/pipelineStore.ts','usePipelineStore',{
    create,acquireProject,stageDone,pictureScenes,captureProviders,voiceProviderMismatch,profileProblems,runPipeline,STAGE_IDS,initialView,reduceView,withDetail,recordFromProject,scriptRecordFor,
    useSettingsStore:{getState:()=>({settings:{ttsProvider:'gemini',ttsVoice:'Leda',ttsModel:'test',textProvider:'gemini',apiBatchSize:5,apiParallel:1,ttsRate:0,ttsVolume:0}})},
    ttsOptions:async()=>({defaultVoice:'Leda',defaultModel:'test',edgeDefaultVoice:'en-US-AriaNeural'}),
    isCancelled:e=>e?.code==='cancelled',toAppError:errorOf,useProjectStore:projects,
    useJobStore:{getState:()=>({jobs:{}})},requestCancel:()=>{},window:{setTimeout},
    createProject:async()=>baseProject(),writeScript:async()=> 'Generated script',writeScriptForStep0:async()=>({script:'Generated script',record:null}),
    applyChannelProfile:(_profile,script)=>projects.getState().update({script}),
    runStage:async()=>{throw Error('test stop');},...overrides,
  });
}

const channel = () => {const p=defaultProfile('channel');p.look.styleId='cinematic_realism';return p;};
const input = (patch={}) => ({profile:channel(),name:'Test',script:'Input script',voiceFile:null,ensureConsent:async()=>true,...patch});

// Execute the real store with the real Zustand implementation, replacing only
// native IO/error imports. Each test receives isolated timer/queue state.
function projectStore(io) {
  const code = stripTypeScriptTypes(readFileSync(new URL('../src/store/projectStore.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  return new Function('create', 'toAppError', 'openProject', 'saveProject', 'assertProjectAvailable', 'isProjectActive', 'invalidateProject', code + '; return useProjectStore;')(
    create, error => ({message: error.message, details: error.message}), io.open, io.save, assertProjectAvailable, isProjectActive, invalidateProject,
  );
}

test('failed saves block close and switching; retry preserves edits', async () => {
  let fail = true;
  const saved = [];
  const store = projectStore({open: async id => ({id, script:'original'}), save: async p => {
    if (fail) throw Error('disk full');
    saved.push(p.script); return 'now';
  }});
  try {
    await store.getState().open('A');
    store.getState().update({script:'important edit'});
    await assert.rejects(store.getState().close(), {message:'disk full'});
    await assert.rejects(store.getState().open('B'), {message:'disk full'});
    assert.equal(store.getState().project.id, 'A');
    assert.equal(store.getState().project.script, 'important edit');
    assert.equal(store.getState().saveState, 'error');
    fail = false;
    await store.getState().close();
    assert.deepEqual(saved, ['important edit']);
    assert.equal(store.getState().project, null);
  } finally { store.getState().discard(); }
});

test('edits arriving while another project loads are saved before switching', async () => {
  let finishOpen;
  const saved=[];
  const store=projectStore({open: id => id==='A' ? Promise.resolve({id,script:'old'}) : new Promise(r=>{finishOpen=()=>r({id,script:'B'});}), save:async p=>{saved.push(p.script);return 'now';}});
  try {
    await store.getState().open('A');
    const switching=store.getState().open('B');
    await new Promise(r=>setImmediate(r));
    store.getState().update({script:'late edit'});
    finishOpen(); await switching;
    assert.deepEqual(saved,['late edit']);
    assert.equal(store.getState().project.id,'B');
  } finally {store.getState().discard();}
});

for (const boundary of ['approval','final work']) test(`cancel during ${boundary} cannot finish the pipeline`, async()=>{
  let cancelled=false,done=false,runs=0;
  const events=[];
  const outcome=await runPipeline({stages:['voice'],isDone:()=>done,pauses:{voice:boundary==='approval'},confirm:async()=>{cancelled=true;return true;},run:async()=>{runs++;done=true;cancelled=boundary==='final work';},cancelRequested:()=>cancelled,isCancel:()=>false,onEvent:e=>events.push(e.type)});
  assert.equal(outcome,'cancelled');
  assert.equal(runs,1);
  assert.equal(events.includes('finished'),false);
});

test('video-only projects skip image generation; empty or unfinished image projects do not',()=>{
  assert.equal(stageDone({scenes:[{mediaType:'video',prompt:'clip'}],mediaMap:{}},'images'),true);
  assert.equal(stageDone({scenes:[],mediaMap:{}},'images'),false);
  assert.equal(stageDone({scenes:[{id:'S01',mediaType:'image',prompt:''}],mediaMap:{}},'images'),false);
  assert.equal(stageDone({scenes:[{id:'S01',mediaType:'image',prompt:'picture'}],mediaMap:{}},'images'),false);
});

test('active project blocks switching, closing and deletion; release restores navigation',async()=>{
  const projects=projectStore({open:async id=>baseProject({id}),save:async()=> 'saved'});
  await projects.getState().open('A');
  const release=acquireProject('A');
  try {
    projects.getState().update({name:'In-progress name'});
    await projects.getState().open('A');
    assert.equal(projects.getState().project.name,'In-progress name');
    assert.throws(()=>projects.getState().update({activePartId:'p2'}),/video is being made/);
    await assert.rejects(projects.getState().open('B'),/video is being made/);
    await assert.rejects(projects.getState().close(),/video is being made/);
    assert.throws(()=>assertProjectDeletable('A'),/being made/);
    assert.throws(()=>acquireProject('B'),/already/);
    assert.equal(projects.getState().project.id,'A');
  } finally {release();}
  await projects.getState().open('B');
  projects.getState().discard();
});

test('two starts during script generation make one request; cancel prevents project creation',async()=>{
  const gate=deferred();let writes=0,creates=0;
  const projects=projectStore({open:async()=>baseProject(),save:async()=> 'saved'});
  const pipeline=pipelineStore(projects,{writeScriptForStep0:async()=>{writes++;return {script:await gate.promise,record:null};},createProject:async()=>{creates++;return baseProject();}});
  const profile=channel();profile.script={writer:'claude',masterPrompt:'Write a story'};
  const args=input({script:'',topic:'A story',profile});
  const first=pipeline.getState().start(args);
  await pipeline.getState().start(args);
  await tick();assert.equal(writes,1);assert.equal(pipeline.getState().running,true);
  pipeline.getState().cancel();gate.resolve('Completed late');await first;
  assert.equal(creates,0);assert.equal(pipeline.getState().running,false);
  projects.getState().discard();
});

test('project creation is reserved synchronously and releases after failure',async()=>{
  const gate=deferred();let creates=0;
  const projects=projectStore({open:async()=>baseProject(),save:async()=> 'saved'});
  const pipeline=pipelineStore(projects,{createProject:async()=>{creates++;await gate.promise;return baseProject();}});
  const first=pipeline.getState().start(input());
  await pipeline.getState().start(input());
  await tick();assert.equal(creates,1);gate.resolve();await first;
  assert.equal(pipeline.getState().running,false);assert.ok(pipeline.getState().error);
  assert.doesNotThrow(()=>assertProjectAvailable('B'));projects.getState().discard();
});

test('failed checkpoint stops external generation and releases project ownership',async()=>{
  let calls=0;
  const projects=projectStore({open:async()=>baseProject(),save:async()=>{throw Error('disk full');}});
  const pipeline=pipelineStore(projects,{runStage:async()=>{calls++;}});
  await pipeline.getState().continueProject('A',defaultProfile('channel'),async()=>true);
  assert.equal(calls,0);assert.ok(pipeline.getState().error);assert.equal(pipeline.getState().running,false);
  assert.doesNotThrow(()=>assertProjectAvailable('B'));projects.getState().discard();
});

test('fresh pipeline resumes saved outputs and persists completion before releasing the run',async()=>{
  let stored=baseProject({voicePath:'voice.wav',voiceOriginalPath:'original.wav',voiceDuration:5,voiceLocked:true,words:[{text:'hello',start:0,end:5}],scenes:[{id:'S01',mediaType:'image',prompt:'picture'}],bibleLocked:true,mediaMap:{S01:'picture.png'},makeVideoRun:{status:'running',completedStages:[],currentStage:'render',failedScenes:[],updatedAt:''}});
  stored.editor=readEditor(stored);stored.editor.audio.mix={path:'mix.wav',builtAt:'old',integrated:-14,truePeak:-1,range:3};
  const projects=projectStore({open:async()=>structuredClone(stored),save:async p=>{stored=structuredClone(p);return 'saved';}});
  const ran=[];
  const profile=defaultProfile('channel');profile.pauses={...NO_PAUSES};
  const pipeline=pipelineStore(projects,{runStage:async stage=>{ran.push(stage);projects.getState().update({renderedAt:'now',exportDurationSeconds:5});}});
  await pipeline.getState().continueProject('A',profile,async()=>true);
  assert.deepEqual(ran,['render']);assert.equal(stored.makeVideoRun.status,'finished');assert.equal(pipeline.getState().view.status,'finished');
  const restored=pipelineStore(projects,{runStage:async()=>assert.fail('finished stages must not rerun')});
  await restored.getState().continueProject('A',profile,async()=>true);
  assert.equal(restored.getState().view.status,'finished');projects.getState().discard();
});

test('script/voice changes invalidate dependent output; metadata and completed render writes do not',()=>{
  const project=baseProject({voiceLocked:true,voicePath:'v.wav',voiceOriginalPath:'o.wav',voiceDuration:8,words:[{text:'old'}],scenes:[{id:'S01',prompt:'p',mediaType:'image'}],renderedAt:'old',exportDurationSeconds:8,exportSizeBytes:100});
  const script=invalidateProject(project,{script:'Replacement'});
  assert.equal(script.voiceLocked,false);assert.equal(script.voiceOriginalPath,null);assert.deepEqual(script.words,[]);assert.deepEqual(script.scenes,[]);assert.equal(script.renderedAt,null);
  const voice=invalidateProject(project,{voicePath:'new.wav',voiceDuration:10});
  assert.deepEqual(voice.words,[]);assert.deepEqual(voice.scenes,[]);
  assert.deepEqual(invalidateProject(project,{name:'Renamed'}),{name:'Renamed'});
  assert.deepEqual(invalidateProject(project,{renderedAt:'new',exportSizeBytes:500}),{renderedAt:'new',exportSizeBytes:500});
});

test('visual edits invalidate export, audio-input edits invalidate mix, but saving a new mix keeps it',()=>{
  const p=baseProject({renderedAt:'old'});p.editor=readEditor(p);p.editor.audio.mix={path:'old.wav',builtAt:'old'};
  assert.equal(invalidateProject(p,{mediaMap:{S01:'new.png'}}).renderedAt,null);
  const changed=invalidateProject(p,{editor:{...p.editor,audio:{...p.editor.audio,musicVolume:13}}});
  assert.equal(changed.editor.audio.mix,null);
  const mix={path:'new.wav',builtAt:'now'};
  const completed=invalidateProject(p,{editor:{...p.editor,audio:{...p.editor.audio,mix}}});
  assert.deepEqual(completed.editor.audio.mix,mix);
  assert.equal(completed.renderedAt,null);
});

test('queue persists project link while generation is running and restores it after restart',async()=>{
  const gate=deferred();const entered=deferred();const memory=new Map();
  const projects=projectStore({open:async()=>baseProject(),save:async()=> 'saved'});
  const pipeline=pipelineStore(projects,{runStage:async()=>{entered.resolve();await gate.promise;throw Error('provider stopped');}});
  const deps={create,...queueLogic,readProfiles,NO_PAUSES,usePipelineStore:pipeline,useSettingsStore:{getState:()=>({settings:{channelProfiles:[channel()]}})},window:{localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}}};
  const queue=loadStore('../src/store/queueStore.ts','useQueueStore',deps);
  queue.getState().add('channel','Video',[{name:'Test',script:'A script'}]);
  const run=queue.getState().run(async()=>true);
  await entered.promise;
  const persisted=JSON.parse(memory.get('videoQueue'));
  assert.equal(persisted[0].projectId,'A');assert.equal(persisted[0].status,'running');
  const restored=loadStore('../src/store/queueStore.ts','useQueueStore',deps);
  assert.equal(restored.getState().items[0].projectId,'A');assert.equal(restored.getState().items[0].status,'waiting');
  gate.resolve();await run;assert.equal(queue.getState().items[0].status,'failed');projects.getState().discard();
});

test('a navigation already loading cannot replace a project once a run acquires it',async()=>{
  const gate=deferred();const projects=projectStore({open:async id=>{if(id==='B')await gate.promise;return baseProject({id});},save:async()=> 'saved'});
  await projects.getState().open('A');
  const navigation=projects.getState().open('B');await tick();
  const release=acquireProject('A');
  try {gate.resolve();await assert.rejects(navigation,/video is being made/);assert.equal(projects.getState().project.id,'A');}
  finally {release();projects.getState().discard();}
});

test('flush waits for edits that arrive during an in-flight write',async()=>{
  const gate=deferred();const entered=deferred();const saved=[];
  const projects=projectStore({open:async()=>baseProject(),save:async p=>{saved.push(p.name);if(saved.length===1){entered.resolve();await gate.promise;}return 'saved';}});
  await projects.getState().open('A');projects.getState().update({name:'first'});
  const flush=projects.getState().flush();await entered.promise;
  projects.getState().update({name:'latest'});gate.resolve();await flush;
  assert.deepEqual(saved,['first','latest']);assert.equal(projects.getState().saveState,'saved');projects.getState().discard();
});

test('a failed save after a stage prevents the next external stage',async()=>{
  const ran=[];
  const projects=projectStore({open:async()=>baseProject(),save:async p=>{if(p.voiceLocked)throw Error('disk full after voice');return 'saved';}});
  const pipeline=pipelineStore(projects,{runStage:async stage=>{ran.push(stage);projects.getState().update({voiceLocked:true,voicePath:'voice.wav',voiceDuration:5});}});
  await pipeline.getState().continueProject('A',channel(),async()=>true);
  assert.deepEqual(ran,['voice']);assert.ok(pipeline.getState().error);assert.equal(pipeline.getState().running,false);projects.getState().discard();
});

test('replacing timings keeps explicit imported results and invalidates old scenes',()=>{
  const p=baseProject({script:'Old',words:[{text:'old'}],scenes:[{id:'S01'}],renderedAt:'old'});
  const words=[{text:'new',start:0,end:1}];
  const patch=invalidateProject(p,{script:'New',words,timingSource:'srt'});
  assert.deepEqual(patch.words,words);assert.equal(patch.timingSource,'srt');assert.deepEqual(patch.scenes,[]);
  assert.equal('voiceOriginalPath' in patch,false,'explicit aligned timings keep their existing narration');
  const part={activePartId:'p2',script:'Part 2',renderedAt:'previous export'};
  assert.deepEqual(invalidateProject(p,part),part);
});

test('failed voice save retains metadata for retry',async()=>{let fail=true,saved;const projects=projectStore({open:async()=>baseProject(),save:async p=>{if(fail)throw Error('disk full');saved=structuredClone(p);return 'saved';}});await projects.getState().open('A');projects.getState().update({voicePath:'voice.wav',voiceOriginalPath:'original.wav',voiceDuration:12,voiceLocked:true});await assert.rejects(projects.getState().flush(),e=>e.message.includes('disk full'));assert.equal(projects.getState().project.voicePath,'voice.wav');fail=false;await projects.getState().flush();assert.equal(saved.voicePath,'voice.wav');projects.getState().discard();});
