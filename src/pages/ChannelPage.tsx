import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Counters, VideoList, useChannelData } from "../components/channels";
import { ErrorNotice } from "../components/ErrorNotice";
import { useConsent } from "../components/imagegen/useConsent";
import { ProfileBasics, ProfileEditing, ProfilePauses, ProfileVoiceLook, StartCard, useProfiles } from "../components/pipeline";
import { Button, SegmentedControl } from "../components/ui";
import { pickSavePath } from "../lib/dialog";
import { toAppError } from "../lib/errors";
import { writeTextFile } from "../lib/files";
import { countVideos, videosOf } from "../lib/pipeline/dashboard";
import { NO_CHANNEL } from "../lib/pipeline/channels";
import { exportProfile, profileProblems } from "../lib/pipeline/profile";
import type { AppError } from "../types";

type Tab = "videos" | "new" | "settings";

/** One channel: its videos with progress, a form for a new video, and its profile. */
export function ChannelPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const profiles = useProfiles();
  const data = useChannelData();
  const { ensure, dialog } = useConsent();
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [voiceFile, setVoiceFile] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const profile = profiles.profiles.find((p) => p.id === id) ?? null;
  const orphan = id === NO_CHANNEL;
  const known = new Set(profiles.profiles.map((p) => p.id));
  const videos = orphan ? data.projects.filter((p) => !known.has(p.channelId)) : videosOf(data.projects, id);
  const requested = params.get("tab");
  const tab: Tab = orphan ? "videos" : requested === "new" || requested === "settings" ? requested : "videos";
  const setTab = (next: Tab) => setParams(next === "videos" ? {} : { tab: next }, { replace: true });
  const busy = data.run.running;

  if (!profile && !orphan) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
        <p className="text-sm text-muted">This channel does not exist.</p>
        <Link to="/channels" className="text-sm text-accent underline">
          Back to all channels
        </Link>
      </section>
    );
  }

  async function exportIt() {
    if (!profile) return;
    setError(null);
    try {
      const path = await pickSavePath("Save the channel profile", `${profile.name}.avprofile`, "Channel profile", ["avprofile", "json"]);
      if (path) await writeTextFile(path, exportProfile(profile));
    } catch (caught) {
      setError(toAppError(caught, "The profile could not be saved."));
    }
  }

  function start() {
    if (!profile) return;
    // The run goes on in the store while the person watches the list, so it is not awaited here.
    void data.run.start({ profile, name, script, voiceFile, ensureConsent: ensure });
    if (profileProblems(profile, { script, voiceFile }).length === 0) {
      setName("");
      setScript("");
      setVoiceFile(null);
      setTab("videos");
    }
  }

  const options: { value: Tab; label: string }[] = orphan
    ? [{ value: "videos", label: "Videos" }]
    : [
        { value: "videos", label: "Videos" },
        { value: "new", label: "New video" },
        { value: "settings", label: "Settings" },
      ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {dialog}
      <div>
        <Link to="/channels" className="text-xs text-muted hover:text-fg">
          ← All channels
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">{profile ? profile.name : "No channel"}</h2>
        {orphan && <p className="text-sm text-muted">Projects made before channels existed, or whose channel was deleted.</p>}
      </div>
      <Counters counts={countVideos(videos, data.active)} />
      {options.length > 1 && <SegmentedControl<Tab> label="Channel sections" value={tab} onChange={setTab} options={options} />}
      {data.error && <ErrorNotice error={data.error} />}
      {data.run.error && <ErrorNotice error={data.run.error} />}
      {error && <ErrorNotice error={error} />}

      {tab === "videos" && (
        <VideoList videos={videos} profiles={profiles.profiles} active={data.active} ensureConsent={ensure} empty={orphan ? "No older projects." : "No videos yet. Open “New video” to make the first one."} />
      )}

      {tab === "new" && profile && (
        <StartCard
          name={name}
          script={script}
          voiceFile={voiceFile}
          disabled={busy}
          problems={data.run.problems}
          onName={setName}
          onScript={setScript}
          onVoiceFile={setVoiceFile}
          onStart={start}
        />
      )}

      {tab === "settings" && profile && (
        <>
          <ProfileBasics profile={profile} onChange={profiles.save} />
          <ProfileVoiceLook profile={profile} onChange={profiles.save} />
          <ProfileEditing profile={profile} onChange={profiles.save} />
          <ProfilePauses profile={profile} onChange={profiles.save} />
          <div className="flex flex-wrap gap-3">
            <Button icon={Download} onClick={() => void exportIt()}>
              Export profile
            </Button>
            <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete channel
            </Button>
          </div>
          {confirmDelete && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Delete the channel">
              <p className="text-sm">Delete the channel "{profile.name}"? Its videos stay on this computer and move to “No channel”.</p>
              <div className="flex gap-2">
                <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    profiles.remove(profile.id);
                    navigate("/channels");
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
