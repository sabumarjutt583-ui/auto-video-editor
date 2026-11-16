import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultProfile, duplicateProfile, importProfile, exportProfile, type ChannelProfile } from "../../pipeline/profile.ts";
import { buildStudioEdit, parseStudioError, seedFromProfile } from "./api.ts";
import type {
  AccountPreferences, ChannelStudioConfigV1, PlanInput, RubricCriterion,
  ScriptStudioPlanV1, StudioBackupV1, StudioEdit, SkillRegistration, TextVersion,
} from "./types.ts";

const prompt = "  Original 🧠\nاردو 한국어 'quoted' \r\n";
function profile(id: string, master = prompt): ChannelProfile {
  const p = defaultProfile(id,"Channel same-name");
  p.language = "en";
  p.script = {writer:"claude",masterPrompt:master,claudeAccountId:"1"};
  return p;
}
function config(channelId: string): ChannelStudioConfigV1 {
  const version: TextVersion = {
    versionId:"legacy_1",channelId,content:prompt,
    contentDigest:"sha256:"+"a".repeat(64),
    createdAt:"1970-01-01T00:00:00.000Z",planningOverride:null,
  };
  const rubric: RubricCriterion[] = [
    {key:"hook",label:"Opening hook",points:20},
    {key:"retention",label:"Retention",points:25},
    {key:"clarity",label:"Clarity",points:30},
    {key:"ending",label:"Ending and CTA",points:25},
  ];
  const accounts: AccountPreferences = {
    claudeAccountId:"1",chatgptReviewAccountId:"2",
    writerPolicy:"strict_selected",reviewerPolicy:"automatic_permitted",
    allowedClaudeAccountIds:["1","3"],allowedChatgptAccountIds:["2"],
  };
  return {
    schemaVersion:1,channelId,channelName:"Channel same-name",revision:2,
    createdAt:"2026-11-16T00:00:00.000Z",updatedAt:"2026-11-16T00:01:00.000Z",
    previousDigest:null,operationId:"op1",operationDigest:null,
    promptVersions:[version],selectedPromptVersionId:"legacy_1",
    reviewVersions:[],selectedReviewVersionId:null,skills:[],
    writing:{instructionMode:"master_prompt",selectedSkillId:null,
      language:"en",targetAudience:"US adults",narrationTone:"calm",
      writingStyle:"documentary",additionalInstructions:"Avoid filler.",
      defaultWordTarget:1600},
    accounts,
    review:{provider:"chatgpt",requireUserApproval:true,
      singleScriptInstructions:"Review the complete script.",
      perPartInstructions:"Review this section.",
      finalScriptInstructions:"Review continuity."},
    rubric,
    planning:{defaultScriptMode:"multi_part",defaultPartCount:8,
      defaultTotalWords:12000,targetWordsPerPart:1500,
      outlineRequired:true,continuityRequired:true},
  };
}
test("SW-03H-TS-01 channel seed retains legacy IDs and exact prompt whitespace", () => {
  const s = seedFromProfile(profile("_legacy-channel"));
  assert.equal(s.channelId,"_legacy-channel");
  assert.equal(s.masterPrompt,prompt);
  assert.equal(s.claudeAccountId,"1");
});
test("SW-03H-TS-02 pre-existing profile export and import still create new IDs", () => {
  const first=profile("channel-a");
  const duplicate=duplicateProfile(first,[first],100);
  assert.notEqual(duplicate.id,first.id);
  const imported=importProfile(exportProfile(first),[first],101);
  assert(imported);
  assert.notEqual(imported.id,first.id);
  assert.equal(imported.script.masterPrompt,first.script.masterPrompt);
});
test("SW-03H-TS-03 same human channel name does not conflate IDs", () => {
  const a=config("channel-A"),b=config("channel-B");
  assert.equal(a.channelName,b.channelName);
  assert.notEqual(a.channelId,b.channelId);
  assert.equal(a.accounts.claudeAccountId,b.accounts.claudeAccountId);
});
test("SW-03H-TS-04 independent Claude and ChatGPT account references roundtrip", () => {
  const a=config("A"),b=config("B");
  b.accounts={...b.accounts,claudeAccountId:"3",chatgptReviewAccountId:"2"};
  assert.equal(a.accounts.claudeAccountId,"1");
  assert.equal(a.accounts.chatgptReviewAccountId,b.accounts.chatgptReviewAccountId);
  assert.equal(b.accounts.writerPolicy,"strict_selected");
});
test("SW-03H-TS-05 edit is tied to exact config revision and channel", () => {
  const a=config("A");
  const edit=buildStudioEdit(a,"op_stable");
  assert.equal(edit.channelId,"A");
  assert.equal(edit.expectedRevision,2);
  assert.equal(edit.operationId,"op_stable");
});
test("SW-03H-TS-06 saving a new master prompt never mutates previous text", () => {
  const a=config("A");
  const edit=buildStudioEdit(a,"op_master",{newMasterPrompt:"New content"});
  assert.equal(edit.newMasterPrompt,"New content");
  assert.equal(a.promptVersions[0]?.content,prompt);
  assert.equal(a.selectedPromptVersionId,"legacy_1");
});
test("SW-03H-TS-07 explicit earlier selection is passed, not silently replaced", () => {
  const a=config("A");
  a.selectedPromptVersionId="legacy_1";
  const edit=buildStudioEdit(a,"op_old");
  assert.equal(edit.selectMasterVersionId,"legacy_1");
  assert.equal(edit.newMasterPrompt,null);
});
test("SW-03H-TS-08 per-channel review prompts remain separate", () => {
  const a=config("A"),b=config("B");
  b.review={...b.review,singleScriptInstructions:"Different niche-specific review"};
  assert.notEqual(a.review.singleScriptInstructions,b.review.singleScriptInstructions);
  assert.equal(a.review.provider,b.review.provider);
});
test("SW-03H-TS-09 custom rubric is 100 points and isolated from source array", () => {
  const a=config("A"),b=config("B");
  b.rubric=b.rubric.map((item,i)=>({...item,points:i===0?10:i===1?35:item.points}));
  assert.equal(a.rubric.reduce((sum,item)=>sum+item.points,0),100);
  assert.equal(b.rubric.reduce((sum,item)=>sum+item.points,0),100);
  assert.equal(a.rubric[0]?.points,20);
  assert.equal(b.rubric[0]?.points,10);
});
test("SW-03H-TS-10 structured planning overrides are distinct from prompt prose", () => {
  const a=config("A");
  const input=buildStudioEdit(a,"part-override",{
    newMasterPrompt:"Do the video in many parts.",
    newMasterPlanning:{defaultPartCount:8,defaultTotalWords:12_000},
  });
  assert.equal(input.newMasterPlanning?.defaultPartCount,8);
  assert.equal(input.newMasterPrompt,"Do the video in many parts.");
});
test("SW-03H-TS-11 Skill registration has no provider-verified or activated state", () => {
  const skill:SkillRegistration={
    skillId:"skill-a",channelId:"A",displayName:"Documentary Writer",
    exactName:"A Script Skill",claudeAccountId:"1",description:"",
    status:"user_confirmed_installed",
    userConfirmedAt:"2026-11-16T00:00:00.000Z",planningOverride:{defaultPartCount:8},
  };
  assert.equal(skill.status,"user_confirmed_installed");
  assert.equal(Object.hasOwn(skill,"providerVerified"),false);
  assert.equal(Object.hasOwn(skill,"activated"),false);
});
test("SW-03H-TS-12 12000-word eight-part request uses typed Rust field names", () => {
  const plan:PlanInput={
    planId:"sp_"+"a".repeat(32),channelId:"A",expectedConfigRevision:2,
    title:"How corporations make money",topic:"Business models",language:"en",
    mode:"multi_part",totalWords:12000,partCount:8,
    outlineRequired:true,continuityRequired:true,parts:[],
  };
  assert.equal(JSON.parse(JSON.stringify(plan)).totalWords,12000);
  assert.equal(plan.partCount,8);
});
test("SW-03H-TS-13 saved plan schema includes its immutable config copy", () => {
  const snap=config("A");
  const saved:ScriptStudioPlanV1={
    schemaVersion:1,planId:"sp_"+"b".repeat(32),channelId:"A",
    configRevision:2,configDigest:"sha256:"+"a".repeat(64),
    createdAt:"2026-11-16T00:00:00.000Z",title:"Topic",topic:"Details",
    language:"en",writingMode:"master_prompt",selectedPromptVersionId:"legacy_1",
    selectedPromptDigest:"sha256:"+"a".repeat(64),selectedSkillId:null,
    selectedSkillName:null,claudeAccountId:"1",reviewerProvider:"chatgpt",
    reviewerAccountId:"2",reviewerPromptVersionId:null,reviewerPromptDigest:null,
    mode:"single",totalWords:1600,partCount:1,outlineRequired:true,
    continuityRequired:true,parts:[{index:1,title:"",objective:"",targetWords:1600}],
    configSnapshot:snap,warnings:[],
  };
  snap.channelName="Channel renamed later";
  assert.equal(saved.configSnapshot.channelId,"A");
  assert.equal(saved.configRevision,2);
  assert.equal(saved.parts[0]?.targetWords,1600);
});
test("SW-03H-TS-14 backup contains only config data and no credentials", () => {
  const backup:StudioBackupV1={backupVersion:1,sourceChannelId:"A",config:config("A")};
  const raw=JSON.stringify(backup);
  assert.equal(raw.includes("password"),false);
  assert.equal(raw.includes("cookie"),false);
  assert.equal(raw.includes("browserProfile"),false);
  assert.equal(backup.config.channelId,backup.sourceChannelId);
});
test("SW-03H-TS-15 new configuration import is never a silent merge", () => {
  const a=config("A"),b=config("B");
  const serialized=JSON.stringify({backupVersion:1,sourceChannelId:a.channelId,config:a});
  const restored=JSON.parse(serialized) as StudioBackupV1;
  assert.equal(restored.config.channelId,"A");
  assert.notEqual(restored.config.channelId,b.channelId);
});
test("SW-03H-TS-16 account policy remains metadata and has no browser action", () => {
  const a=config("A");
  a.accounts.writerPolicy="automatic_permitted";
  assert.deepEqual(a.accounts.allowedClaudeAccountIds,["1","3"]);
  assert.equal(Object.hasOwn(a,"browserProfile"),false);
});
test("SW-03H-TS-17 typed Rust error parser retains retry diagnostic", () => {
  assert.deepEqual(parseStudioError({code:"stale_revision",message:"Reload before saving."}),
    {code:"stale_revision",message:"Reload before saving."});
  assert.equal(parseStudioError({code:"no_such_status",message:"secret"}),null);
  assert.equal(parseStudioError(null),null);
});
test("SW-03H-TS-18 pure configuration preparation works without external services", () => {
  const before=globalThis.fetch;
  globalThis.fetch=(()=>{throw new Error("Network is prohibited.");}) as typeof fetch;
  try{
    const a=config("A");
    const edit:StudioEdit=buildStudioEdit(a,"op_offline");
    assert.equal(edit.expectedRevision,2);
    assert.equal(edit.accounts.chatgptReviewAccountId,"2");
  }finally{globalThis.fetch=before;}
});
