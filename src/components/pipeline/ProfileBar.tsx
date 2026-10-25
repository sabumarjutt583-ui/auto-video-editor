import { Copy, Download, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { pickFile, pickSavePath } from "../../lib/dialog";
import { toAppError } from "../../lib/errors";
import { writeTextFile } from "../../lib/files";
import { defaultProfile, duplicateProfile, exportProfile, importProfile, newProfileId, type ChannelProfile } from "../../lib/pipeline/profile";
import { readTextFile } from "../../lib/timing/api";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Select } from "../ui";
import type { ProfilesView } from "./useProfiles";

interface Props {
  view: ProfilesView;
  disabled: boolean;
}

/** Choose, add, copy, delete, export and import channel profiles. */
export function ProfileBar({ view, disabled }: Props) {
  const { profiles, chosen } = view;
  const [error, setError] = useState<AppError | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function exportIt(profile: ChannelProfile) {
    setError(null);
    try {
      const path = await pickSavePath("Save the channel profile", `${profile.name}.avprofile`, "Channel profile", ["avprofile", "json"]);
      if (path) await writeTextFile(path, exportProfile(profile));
    } catch (caught) {
      setError(toAppError(caught, "The profile could not be saved."));
    }
  }

  async function importIt() {
    setError(null);
    try {
      const path = await pickFile("Choose a channel profile", "Channel profile", ["avprofile", "json"]);
      if (!path) return;
      const profile = importProfile(await readTextFile(path), profiles);
      if (!profile) {
        setError({ message: "That file is not a channel profile.", details: `Not a profile file: ${path}` });
        return;
      }
      view.save(profile);
    } catch (caught) {
      setError(toAppError(caught, "The profile could not be read."));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNotice error={error} />}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="profile-pick" className="mb-1.5 block text-sm font-medium">
            Channel profile
          </label>
          <Select id="profile-pick" value={chosen?.id ?? ""} disabled={disabled || profiles.length === 0} onChange={(e) => view.choose(e.target.value)}>
            {profiles.length === 0 && <option value="">No profile yet</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <Button icon={Plus} disabled={disabled} onClick={() => view.save(defaultProfile(newProfileId(profiles), "New channel"))}>
          New
        </Button>
        <Button icon={Copy} disabled={disabled || !chosen} onClick={() => chosen && view.save(duplicateProfile(chosen, profiles))}>
          Copy
        </Button>
        <Button icon={Upload} disabled={disabled} onClick={() => void importIt()}>
          Import
        </Button>
        <Button icon={Download} disabled={disabled || !chosen} onClick={() => chosen && void exportIt(chosen)}>
          Export
        </Button>
        <Button variant="danger" icon={Trash2} disabled={disabled || !chosen} onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>
      {confirmDelete && chosen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Delete the channel profile">
          <p className="text-sm">Delete the profile "{chosen.name}"? Videos already made are not changed.</p>
          <div className="flex gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                view.remove(chosen.id);
                setConfirmDelete(false);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
