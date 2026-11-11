import { Save, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useBeforeUnload } from "react-router-dom";
import { toAppError } from "../../lib/errors";
import { readProfile, type ChannelProfile } from "../../lib/pipeline/profile";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { ProfileBasics, ProfileEditing, ProfilePauses, ProfileScript, ProfileVoiceLook } from "../pipeline";
import { ScriptWriterCard } from "../settings/ScriptWriterCard";
import { Button } from "../ui";

interface Props {
  profile: ChannelProfile;
  section: "settings" | "script";
  onSave: (profile: ChannelProfile) => Promise<void>;
}

// Keep unsaved edits when navigating elsewhere, separately for each channel.
const drafts = new Map<string, { value: ChannelProfile; baseline: string }>();

/** One draft shared by both channel settings tabs; only Save commits it to disk. */
export function ChannelSettingsEditor({ profile, section, onSave }: Props) {
  const [draft, setDraft] = useState(() => drafts.get(profile.id)?.value ?? profile);
  const [baseline, setBaseline] = useState(() => drafts.get(profile.id)?.baseline ?? JSON.stringify(profile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;

  useEffect(() => {
    if (!dirty && !saving) {
      setDraft(profile);
      setBaseline(JSON.stringify(profile));
    }
  }, [profile, dirty, saving]);

  useBeforeUnload((event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });

  function change(next: ChannelProfile) { drafts.set(profile.id, { value: next, baseline }); setDraft(next); setSaved(false); }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const cleaned = readProfile(draft, profile.id);
    try {
      await onSave(cleaned);
      drafts.delete(profile.id);
      setDraft(cleaned);
      setBaseline(JSON.stringify(cleaned));
      setSaved(true);
    } catch (caught) {
      setError(toAppError(caught, "The channel settings could not be saved. Your changes are still here; try Save again."));
    } finally { setSaving(false); }
  }

  return <div className="flex flex-col gap-6">
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <p className="font-semibold">{section === "script" ? "Claude Script" : "Channel settings"} · {draft.name}</p>
        <p className="text-sm text-muted" role="status">{saving ? "Saving channel settings…" : error ? "Save failed. Your changes have been kept here." : dirty ? "Unsaved changes" : saved ? "Channel settings saved" : "All channel settings are saved"}</p>
        <p className="text-xs text-muted">Save applies both settings tabs to this channel. Videos already started keep their existing settings.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={RotateCcw} disabled={saving || !dirty} onClick={() => { drafts.delete(profile.id); setDraft(profile); setBaseline(JSON.stringify(profile)); setSaved(false); setError(null); }}>Discard changes</Button>
        <Button variant="primary" icon={Save} loading={saving} disabled={saving} onClick={() => void save()}>Save channel settings</Button>
      </div>
    </div>
    {error && <ErrorNotice error={error} />}
    <fieldset disabled={saving} className="flex min-w-0 flex-col gap-6">
      {section === "script" ? <>
        <ProfileScript profile={draft} onChange={change} />
        <details className="rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium">Manage Claude accounts and sign-in</summary>
          <p className="my-3 text-sm text-muted">Accounts are shared by the app. The account selected above is saved separately for this channel. Sign-in actions take effect immediately.</p>
          <ScriptWriterCard />
        </details>
      </> : <>
        <ProfileBasics profile={draft} onChange={change} />
        <ProfileVoiceLook profile={draft} onChange={change} />
        <ProfileEditing profile={draft} onChange={change} />
        <ProfilePauses profile={draft} onChange={change} />
      </>}
    </fieldset>
    <div className="flex justify-end"><Button variant="primary" icon={Save} loading={saving} disabled={saving} onClick={() => void save()}>Save channel settings</Button></div>
  </div>;
}
