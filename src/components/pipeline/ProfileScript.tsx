import { MAX_MASTER_PROMPT } from "../../lib/script/prompt";
import type { ChannelProfile, ScriptWriter } from "../../lib/pipeline/profile";
import { Card, Field, Select } from "../ui";

interface Props {
  profile: ChannelProfile;
  onChange: (profile: ChannelProfile) => void;
}

/** How the scripts of this channel are written: the master prompt that goes with every topic. */
export function ProfileScript({ profile, onChange }: Props) {
  const { script } = profile;
  return (
    <Card title="Script writing" description="Write the channel's style once. For every video you give only the topic, and the script writer (Claude) writes the script with this master prompt.">
      <Field label="Script writer" htmlFor="p-writer" hint="Set up the Claude account in Settings first. 'Off' = you paste the script yourself.">
        <Select id="p-writer" value={script.writer} onChange={(e) => onChange({ ...profile, script: { ...script, writer: e.target.value as ScriptWriter } })}>
          <option value="off">Off (I paste the script)</option>
          <option value="claude">Claude (my own account)</option>
        </Select>
      </Field>
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
