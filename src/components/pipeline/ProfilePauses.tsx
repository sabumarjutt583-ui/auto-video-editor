import { STAGES } from "../../lib/pipeline/stages";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import { Card, Checkbox } from "../ui";

interface Props {
  profile: ChannelProfile;
  onChange: (profile: ChannelProfile) => void;
}

/** Steps where "Make video" stops and waits for you. Everything else runs by itself. */
export function ProfilePauses({ profile, onChange }: Props) {
  return (
    <Card title="Ask me before…" description="Tick a step to check it before it starts (for example to listen to the voice). Unticked steps run by themselves.">
      <div className="grid gap-3 sm:grid-cols-2">
        {STAGES.map((stage) => (
          <Checkbox key={stage.id} label={stage.label} checked={profile.pauses[stage.id]} onChange={(e) => onChange({ ...profile, pauses: { ...profile.pauses, [stage.id]: e.target.checked } })} />
        ))}
      </div>
    </Card>
  );
}
