import { useEffect, useState } from "react";

import { MAX_MASTER_PROMPT } from "../../lib/script/prompt";
import type { ChannelProfile, ScriptWriter } from "../../lib/pipeline/profile";
import { scriptAccounts, type ScriptAccountStatus } from "../../lib/script/api";
import { Button, Card, Field, Select } from "../ui";

interface Props {
  profile: ChannelProfile;
  onChange: (profile: ChannelProfile) => void;
}

/** How the scripts of this channel are written: the master prompt that goes with every topic. */
export function ProfileScript({ profile, onChange }: Props) {
  const { script } = profile;
  const [accounts, setAccounts] = useState<ScriptAccountStatus[] | null>(null);
  const [accountError, setAccountError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (script.writer !== "claude") return;
    let live = true;
    setAccounts(null);
    setAccountError(false);
    void scriptAccounts().then((list) => {
      if (live) setAccounts(list);
    }).catch(() => {
      if (live) { setAccounts([]); setAccountError(true); }
    });
    return () => {
      live = false;
    };
  }, [script.writer, refresh]);
  return (
    <Card title="Script writing" description="Write the channel's style once. For every video you give only the topic, and the script writer (Claude) writes the script with this master prompt.">
      <Field label="Script writer" htmlFor="p-writer" hint="Set up the Claude account in Settings first. 'Off' = you paste the script yourself.">
        <Select id="p-writer" value={script.writer} onChange={(e) => onChange({ ...profile, script: { ...script, writer: e.target.value as ScriptWriter } })}>
          <option value="off">Off (I paste the script)</option>
          <option value="claude">Claude (my own account)</option>
        </Select>
      </Field>
      {script.writer === "claude" && (<>
        <Field label="Claude account for this channel" htmlFor="p-claude-account" hint="Automatic rotation = the accounts are tried in list order. Pick one to always try that account first for this channel; the others are still used if it is limited or signed out.">
          <Select id="p-claude-account" value={script.claudeAccountId ?? ""} onChange={(e) => onChange({ ...profile, script: { ...script, claudeAccountId: e.target.value === "" ? null : e.target.value } })}>
            <option value="">Automatic rotation (all accounts)</option>
            {script.claudeAccountId && accounts && !accounts.some((a) => a.id === script.claudeAccountId) && <option value={script.claudeAccountId}>Saved account (unavailable — choose another account)</option>}
            {(accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.connected ? "" : " (not signed in)"}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setRefresh((value) => value + 1)}>Refresh account list</Button>
          <p className="text-sm text-muted" role="status">{accountError ? "Could not load Claude accounts. Refresh to try again." : accounts === null ? "Loading Claude accounts…" : accounts.length === 0 ? "No Claude accounts yet. Add one below." : `${accounts.filter((a) => a.connected).length} of ${accounts.length} accounts signed in`}</p>
        </div>
        </>
      )}
      <Field label="Master prompt" htmlFor="p-master" hint={`${script.masterPrompt.length.toLocaleString()} of ${MAX_MASTER_PROMPT.toLocaleString()} characters. Write who tells the story, the language, the length, the structure, the tone, and what to avoid.`}>
        <textarea
          id="p-master"
          value={script.masterPrompt}
          rows={12}
          maxLength={MAX_MASTER_PROMPT}
          onChange={(e) => onChange({ ...profile, script: { ...script, masterPrompt: e.target.value } })}
          placeholder="You write voice-over scripts for a faceless YouTube channel about ... Write in ... The script is about ... minutes long ..."
          className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent"
        />
      </Field>
    </Card>
  );
}
