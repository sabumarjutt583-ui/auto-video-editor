import { useState } from "react";
import { Button } from "../ui";
import { studioOperationId } from "../../lib/script/studio/api.ts";
import type {
  AccountPolicy, ChannelStudioConfigV1, SkillRegistration, SkillInstallStatus,
  StudioAccountMetadata, WritingMode, ReviewerProvider, RubricCriterion, ScriptMode,
} from "../../lib/script/studio/types.ts";

interface Props {
  config: ChannelStudioConfigV1;
  onChange: (next: ChannelStudioConfigV1) => void;
  newMaster: string;
  setNewMaster: (text: string) => void;
  newReviewPrompt: string;
  setNewReviewPrompt: (text: string) => void;
  newMasterParts: number | null;
  setNewMasterParts: (count: number | null) => void;
  claude: readonly StudioAccountMetadata[];
  chatgpt: readonly StudioAccountMetadata[];
}
const cn = "w-full rounded border border-line bg-surface p-2 text-sm";
const small = "text-xs text-muted";
const validAccount = (items: readonly StudioAccountMetadata[], id: string | null): boolean =>
  id === null || items.some(item => item.id === id);
const number = (n: string): number => Number(n);
const accountOpts = (list: readonly StudioAccountMetadata[]) =>
  list.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>);

export function StudioConfigSections({
  config, onChange, newMaster, setNewMaster, newReviewPrompt, setNewReviewPrompt,
  newMasterParts, setNewMasterParts, claude, chatgpt,
}: Props) {
  const [skillId, setSkillId] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDisplay, setSkillDisplay] = useState("");
  const [skillAccount, setSkillAccount] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillStatus, setSkillStatus] = useState<SkillInstallStatus>("registered_locally");
  const [skillPartCount, setSkillPartCount] = useState<number | null>(null);
  const [skillNote, setSkillNote] = useState("");
  const update = (part: Partial<ChannelStudioConfigV1>) => onChange({ ...config, ...part });
  const writing = config.writing;
  const accounts = config.accounts;
  const review = config.review;
  const planning = config.planning;
  const activeMaster = config.promptVersions.find(v => v.versionId === config.selectedPromptVersionId);
  const activeReview = config.reviewVersions.find(v => v.versionId === config.selectedReviewVersionId);
  const totalRubric = config.rubric.reduce((sum, item) => sum + item.points, 0);
  function modifyRubric(index: number, field: "label" | "points", value: string) {
    const next = config.rubric.map((item, i) => i !== index ? item : {
      ...item, [field]: field === "points" ? number(value) : value,
    });
    update({rubric: next});
  }
  function startSkillEdit(id: string) {
    setSkillId(id); setSkillNote("");
    const registered = config.skills.find(item => item.skillId === id);
    setSkillName(registered?.exactName ?? "");
    setSkillDisplay(registered?.displayName ?? "");
    setSkillAccount(registered?.claudeAccountId ?? accounts.claudeAccountId ?? "");
    setSkillDescription(registered?.description ?? "");
    setSkillStatus(registered?.status ?? "registered_locally");
    setSkillPartCount(registered?.planningOverride?.defaultPartCount ?? null);
  }
  function saveSkill() {
    const display = skillDisplay.trim();
    const exact = skillName.trim();
    if (!display || !exact || !skillAccount) {
      setSkillNote("Enter the display name, exact Skill name and an existing Claude account.");
      return;
    }
    if (!claude.some(account => account.id === skillAccount)) {
      setSkillNote("The selected Claude account is missing. Refresh account metadata.");
      return;
    }
    if (skillPartCount !== null && (!Number.isSafeInteger(skillPartCount) || skillPartCount < 1 || skillPartCount > 40)) {
      setSkillNote("Preferred part count must be between 1 and 40."); return;
    }
    const previous = config.skills.find(v => v.skillId === skillId);
    const registered: SkillRegistration = {
      skillId: previous?.skillId ?? studioOperationId("sk"),
      channelId: config.channelId, displayName: display, exactName: exact,
      claudeAccountId: skillAccount, description: skillDescription,
      status: skillStatus,
      userConfirmedAt: skillStatus === "user_confirmed_installed"
        ? previous?.userConfirmedAt ?? new Date().toISOString() : null,
      planningOverride: skillPartCount === null ? null : {defaultPartCount: skillPartCount},
    };
    const next = previous
      ? config.skills.map(item => item.skillId === previous.skillId ? registered : item)
      : [...config.skills, registered];
    update({skills: next, writing: {
      ...writing, selectedSkillId: registered.skillId,
    }});
    setSkillId(registered.skillId);
    setSkillNote("Skill registered in this channel's UNSAVED Studio draft. Save configuration to persist.");
  }
  function allow(provider: "claude" | "chatgpt", id: string, checked: boolean) {
    const key = provider === "claude" ? "allowedClaudeAccountIds" : "allowedChatgptAccountIds";
    const prev = accounts[key];
    update({accounts: {...accounts, [key]: checked
      ? [...new Set([...prev, id])] : prev.filter(value => value !== id)}});
  }
  function changePolicy(key: "writerPolicy" | "reviewerPolicy", policy: string) {
    update({accounts: {...accounts, [key]: policy as AccountPolicy}});
  }
  return (
    <div className="space-y-4">
      <details open className="rounded border border-line p-3 space-y-2">
        <summary className="cursor-pointer font-semibold">Writing configuration and Master Prompt versions</summary>
        <div className="mt-3 space-y-2">
          <label className="block text-xs">Writing instruction mode</label>
          <select className={cn} value={writing.instructionMode} onChange={e => update({writing: {
            ...writing, instructionMode: e.target.value as WritingMode,
          }})}>
            <option value="master_prompt">Master Prompt only</option>
            <option value="claude_skill">Registered Claude Skill only (not activated remotely)</option>
            <option value="master_plus_skill">Master Prompt + registered Claude Skill</option>
          </select>
          <label className="block text-xs">Active Master Prompt version</label>
          <select className={cn} value={config.selectedPromptVersionId ?? ""} onChange={e =>
            update({selectedPromptVersionId: e.target.value || null})}>
            <option value="">No saved version</option>
            {config.promptVersions.map(v => <option key={v.versionId} value={v.versionId}>
              {v.versionId} · {v.createdAt}</option>)}
          </select>
          {activeMaster && <>
            <p className={small}>Active SHA-256: <span className="break-all">{activeMaster.contentDigest}</span></p>
            <textarea className={cn} aria-label="Exact saved Master Prompt" readOnly rows={5} value={activeMaster.content}/>
          </>}
          <label className="block text-xs">Create a NEW immutable Master Prompt version (leave blank to keep existing)</label>
          <textarea className={cn} rows={6} maxLength={64_000} value={newMaster}
            onChange={e => setNewMaster(e.target.value)}
            placeholder="Exact new Master Prompt. Saved only after Save Studio configuration." />
          <label className="block text-xs">Structured preferred parts for the NEW prompt (optional, not inferred from prose)</label>
          <input className={cn} type="number" min={1} max={40} value={newMasterParts ?? ""}
            onChange={e => setNewMasterParts(e.target.value === "" ? null : number(e.target.value))}/>
          {([
            ["language", "Narration language"],
            ["targetAudience", "Target audience"],
            ["narrationTone", "Narration tone"],
            ["writingStyle", "Writing style"],
            ["additionalInstructions", "Additional writing instructions"],
          ] as const).map(([field, label]) => (
            <label key={field} className="block text-xs">{label}
              <textarea className={cn} rows={field === "additionalInstructions" ? 3 : 1}
                value={writing[field]} onChange={e =>
                  update({writing: {...writing, [field]: e.target.value}})}/>
            </label>
          ))}
          <label className="block text-xs">Default single-video word target
            <input className={cn} type="number" min={50} max={20000}
              value={writing.defaultWordTarget} onChange={e =>
                update({writing: {...writing, defaultWordTarget: number(e.target.value)}})}/>
          </label>
        </div>
      </details>

      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer font-semibold">Claude Skill registry — local metadata only</summary>
        <div className="mt-3 space-y-2">
          <p className={small}>Register manually installed Skills. This app cannot verify installation or activate any Skill in Claude.</p>
          <label className="block text-xs">Selected default Skill
            <select className={cn} value={writing.selectedSkillId ?? ""} onChange={e =>
              update({writing: {...writing, selectedSkillId: e.target.value || null}})}>
              <option value="">No selected Skill</option>
              {config.skills.map(skill => <option key={skill.skillId} value={skill.skillId}>
                {skill.displayName} · {skill.claudeAccountId} · {skill.status}</option>)}
            </select>
          </label>
          <label className="block text-xs">Edit existing Skill or register new
            <select className={cn} value={skillId} onChange={e => startSkillEdit(e.target.value)}>
              <option value="">Register a new Skill</option>
              {config.skills.map(item => <option key={item.skillId} value={item.skillId}>
                {item.displayName}</option>)}
            </select>
          </label>
          <label className="block text-xs">Display name
            <input className={cn} maxLength={120} value={skillDisplay} onChange={e => setSkillDisplay(e.target.value)}/>
          </label>
          <label className="block text-xs">Exact registered Skill name
            <input className={cn} maxLength={150} value={skillName} onChange={e => setSkillName(e.target.value)}/>
          </label>
          <label className="block text-xs">Associated Claude account
            <select className={cn} value={skillAccount} onChange={e => setSkillAccount(e.target.value)}>
              <option value="">Choose account</option>{accountOpts(claude)}
            </select>
          </label>
          <label className="block text-xs">Local installation status
            <select className={cn} value={skillStatus} onChange={e => setSkillStatus(e.target.value as SkillInstallStatus)}>
              <option value="registered_locally">Registered locally — not verified</option>
              <option value="user_confirmed_installed">User reports installed — not provider-verified</option>
              <option value="needs_attention">Needs attention</option>
            </select>
          </label>
          <label className="block text-xs">Description
            <textarea className={cn} maxLength={1000} value={skillDescription}
              onChange={e => setSkillDescription(e.target.value)}/>
          </label>
          <label className="block text-xs">Structured preferred part count for this Skill (optional)
            <input className={cn} type="number" min={1} max={40}
              value={skillPartCount ?? ""} onChange={e =>
                setSkillPartCount(e.target.value === "" ? null : number(e.target.value))}/>
          </label>
          {skillNote && <p role="status" className={small}>{skillNote}</p>}
          <Button onClick={saveSkill}>Add / update local Skill registration</Button>
        </div>
      </details>

      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer font-semibold">Writer and reviewer account preferences</summary>
        <div className="mt-3 space-y-2">
          <p className={small}>Account metadata comes from existing account managers. No sign-in or automatic rotation occurs here.</p>
          <label className="block text-xs">Preferred Claude writer account
            <select className={cn} value={accounts.claudeAccountId ?? ""} onChange={e =>
              update({accounts: {...accounts, claudeAccountId: e.target.value || null}})}>
              <option value="">No account selected</option>{accountOpts(claude)}
            </select>
          </label>
          {!validAccount(claude, accounts.claudeAccountId) &&
            <p role="alert" className="text-xs text-danger">Configured Claude account is missing; choose an existing account.</p>}
          <label className="block text-xs">Preferred ChatGPT review account
            <select className={cn} value={accounts.chatgptReviewAccountId ?? ""} onChange={e =>
              update({accounts: {...accounts, chatgptReviewAccountId: e.target.value || null}})}>
              <option value="">No reviewer account selected</option>{accountOpts(chatgpt)}
            </select>
          </label>
          {!validAccount(chatgpt, accounts.chatgptReviewAccountId) &&
            <p role="alert" className="text-xs text-danger">Configured ChatGPT account is missing; choose an existing account.</p>}
          <label className="block text-xs">Writer account policy (future integration only)
            <select className={cn} value={accounts.writerPolicy} onChange={e => changePolicy("writerPolicy",e.target.value)}>
              <option value="strict_selected">Strict selected account</option>
              <option value="automatic_permitted">Automatic permitted selection — NOT IMPLEMENTED</option>
            </select>
          </label>
          <label className="block text-xs">Reviewer account policy (future integration only)
            <select className={cn} value={accounts.reviewerPolicy} onChange={e => changePolicy("reviewerPolicy",e.target.value)}>
              <option value="strict_selected">Strict selected account</option>
              <option value="automatic_permitted">Automatic permitted selection — NOT IMPLEMENTED</option>
            </select>
          </label>
          <p className={small}>Explicitly permitted writer accounts (metadata, no switching):</p>
          {claude.map(account => <label key={account.id} className="flex gap-2 text-xs">
            <input type="checkbox" checked={accounts.allowedClaudeAccountIds.includes(account.id)}
              onChange={e => allow("claude",account.id,e.target.checked)}/>{account.name}</label>)}
          <p className={small}>Explicitly permitted reviewer accounts (metadata, no switching):</p>
          {chatgpt.map(account => <label key={account.id} className="flex gap-2 text-xs">
            <input type="checkbox" checked={accounts.allowedChatgptAccountIds.includes(account.id)}
              onChange={e => allow("chatgpt",account.id,e.target.checked)}/>{account.name}</label>)}
        </div>
      </details>

      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer font-semibold">Custom AI reviewer prompt and scoring rubric</summary>
        <div className="mt-3 space-y-2">
          <label className="block text-xs">Reviewer provider (preference only)
            <select className={cn} value={review.provider} onChange={e =>
              update({review: {...review, provider: e.target.value as ReviewerProvider}})}>
              <option value="none">No reviewer selected</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={review.requireUserApproval}
            onChange={e => update({review: {...review, requireUserApproval: e.target.checked}})}/>
            Require human approval</label>
          <label className="block text-xs">Saved reviewer prompt version
            <select className={cn} value={config.selectedReviewVersionId ?? ""}
              onChange={e => update({selectedReviewVersionId: e.target.value || null})}>
              <option value="">No saved reviewer prompt</option>
              {config.reviewVersions.map(v => <option key={v.versionId} value={v.versionId}>
                {v.versionId} · {v.createdAt}</option>)}
            </select>
          </label>
          {activeReview && <>
            <p className={small}>Reviewer prompt SHA-256: <span className="break-all">{activeReview.contentDigest}</span></p>
            <textarea className={cn} aria-label="Saved reviewer prompt" readOnly rows={4} value={activeReview.content}/>
          </>}
          <label className="block text-xs">Create a NEW reviewer prompt version
            <textarea className={cn} rows={5} value={newReviewPrompt} maxLength={64_000}
              onChange={e => setNewReviewPrompt(e.target.value)}/>
          </label>
          {([
            ["singleScriptInstructions","Review one complete script"],
            ["perPartInstructions","Review each script part"],
            ["finalScriptInstructions","Review the combined final script"],
          ] as const).map(([field,label]) =>
            <label key={field} className="block text-xs">{label}
              <textarea className={cn} rows={3} value={review[field]}
                onChange={e => update({review: {...review, [field]: e.target.value}})}/>
            </label>)}
          <p className="text-sm font-medium">Editable 100-point rubric — total: {totalRubric}/100</p>
          {totalRubric !== 100 && <p role="alert" className="text-xs text-danger">Weights must total exactly 100 before saving.</p>}
          {config.rubric.map((criterion,index) =>
            <div key={criterion.key} className="grid grid-cols-[1fr_6rem_auto] gap-2">
              <input aria-label={"Rubric "+criterion.key} className={cn} value={criterion.label}
                onChange={e => modifyRubric(index,"label",e.target.value)}/>
              <input aria-label={"Points "+criterion.key} className={cn} type="number" min={0} max={100}
                value={criterion.points} onChange={e => modifyRubric(index,"points",e.target.value)}/>
              <Button disabled={config.rubric.length <= 1}
                onClick={() => update({rubric: config.rubric.filter((_,i) => i !== index)})}>
                Remove
              </Button>
            </div>)}
          <Button disabled={config.rubric.length >= 24}
            onClick={() => update({rubric: [...config.rubric, {
              key: studioOperationId("criterion"), label: "New criterion", points: 0,
            } satisfies RubricCriterion]})}>Add rubric criterion</Button>
        </div>
      </details>

      <details className="rounded border border-line p-3">
        <summary className="cursor-pointer font-semibold">Channel default single/multi-part planning</summary>
        <div className="mt-3 space-y-2">
          <label className="block text-xs">Default mode
            <select className={cn} value={planning.defaultScriptMode} onChange={e =>
              update({planning: {...planning, defaultScriptMode: e.target.value as ScriptMode}})}>
              <option value="single">Single complete script</option>
              <option value="multi_part">Multi-part planned script</option>
            </select>
          </label>
          {([
            ["defaultTotalWords","Default total words"],
            ["defaultPartCount","Default part count (1–40)"],
          ] as const).map(([field,label]) =>
            <label key={field} className="block text-xs">{label}
              <input className={cn} type="number" min={field === "defaultPartCount" ? 1 : 50}
                max={field === "defaultPartCount" ? 40 : 200000}
                value={planning[field]} onChange={e =>
                  update({planning: {...planning, [field]: number(e.target.value)}})}/>
            </label>)}
          <label className="block text-xs">Preferred words per part (optional; structured)
            <input className={cn} type="number" min={50} max={200000}
              value={planning.targetWordsPerPart ?? ""}
              onChange={e => update({planning: {...planning,
                targetWordsPerPart: e.target.value === "" ? null : number(e.target.value)}})}/>
          </label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={planning.outlineRequired}
            onChange={e => update({planning: {...planning, outlineRequired: e.target.checked}})}/>
            Require an outline</label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={planning.continuityRequired}
            onChange={e => update({planning: {...planning, continuityRequired: e.target.checked}})}/>
            Require continuity notes</label>
        </div>
      </details>
    </div>
  );
}
