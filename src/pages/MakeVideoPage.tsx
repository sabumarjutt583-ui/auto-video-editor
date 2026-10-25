import { Film, FolderOpen, Play, RotateCw, Square, Wand2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorNotice } from "../components/ErrorNotice";
import { useConsent } from "../components/imagegen/useConsent";
import { ProfileBar, ProfileBasics, ProfileEditing, ProfilePauses, ProfileVoiceLook, RunPanel, StartCard, useMakeVideo, useProfiles } from "../components/pipeline";
import { Button, Card, SegmentedControl } from "../components/ui";
import { toAppError } from "../lib/errors";
import { defaultProfile, newProfileId } from "../lib/pipeline/profile";
import { stageLabel } from "../lib/pipeline/stages";
import { showInFolder } from "../lib/render/api";
import { formatSize } from "../lib/render/request";
import type { AppError } from "../types";

type Tab = "make" | "profile";

/** One page that makes a whole video from a script: channel profile in, finished MP4 out. */
export function MakePage() {
  const navigate = useNavigate();
  const profiles = useProfiles();
  const run = useMakeVideo();
  const { ensure, dialog } = useConsent();
  const [tab, setTab] = useState<Tab>("make");
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [voiceFile, setVoiceFile] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<AppError | null>(null);
  const { chosen } = profiles;
  const busy = run.running;
  const started = run.view.status !== "idle";

  async function showFile(path: string) {
    setFolderError(null);
    try {
      if (run.projectId) await showInFolder(run.projectId, path);
    } catch (caught) {
      setFolderError(toAppError(caught, "The folder could not be opened."));
    }
  }

  if (!chosen) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
        <h2 className="text-base font-semibold tracking-tight">Make Video</h2>
        <p className="text-sm text-muted">Start with a channel profile. It keeps the voice, style, captions and music of one channel, so you set them only once.</p>
        <Button variant="primary" icon={Wand2} onClick={() => profiles.save(defaultProfile(newProfileId(profiles.profiles), "My channel"))}>
          Create the first profile
        </Button>
      </section>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {dialog}
      <ProfileBar view={profiles} disabled={busy} />
      <SegmentedControl<Tab>
        label="Make video or edit the channel profile"
        value={tab}
        onChange={setTab}
        options={[
          { value: "make", label: "Make a video" },
          { value: "profile", label: "Channel profile" },
        ]}
      />

      {tab === "profile" && (
        <>
          <ProfileBasics profile={chosen} onChange={profiles.save} />
          <ProfileVoiceLook profile={chosen} onChange={profiles.save} />
          <ProfileEditing profile={chosen} onChange={profiles.save} />
          <ProfilePauses profile={chosen} onChange={profiles.save} />
        </>
      )}

      {tab === "make" && (
        <>
          {!started && (
            <StartCard
              name={name}
              script={script}
              voiceFile={voiceFile}
              disabled={busy}
              problems={run.problems}
              onName={setName}
              onScript={setScript}
              onVoiceFile={setVoiceFile}
              onStart={() => void run.start({ profile: chosen, name, script, voiceFile, ensureConsent: ensure })}
            />
          )}

          {started && <RunPanel view={run.view} />}

          {run.waiting && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="Waiting for you">
              <p className="text-sm">Next step: <strong>{stageLabel(run.waiting)}</strong>. Check what was made so far, then continue.</p>
              <div className="flex gap-2">
                <Button onClick={() => navigate("/prompt-generator")}>Look at the project</Button>
                <Button onClick={() => run.answer(false)}>Stop here</Button>
                <Button variant="primary" icon={Play} onClick={() => run.answer(true)}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {run.error && <ErrorNotice error={run.error} />}
          {folderError && <ErrorNotice error={folderError} />}

          {run.finished && (
            <Card title="Your video is ready" description={`${formatSize(run.finished.sizeBytes)} · made in ${Math.round(run.finished.seconds)} seconds`} icon={Film}>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" icon={FolderOpen} onClick={() => void showFile(run.finished?.path ?? "")}>
                  Show the video
                </Button>
                <Button onClick={() => navigate("/auto-editor")}>Open in Auto Editor</Button>
                <Button onClick={run.reset}>Make another video</Button>
              </div>
            </Card>
          )}

          {started && !busy && run.view.status !== "finished" && (
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" icon={RotateCw} onClick={() => void run.resume()}>
                Continue where it stopped
              </Button>
              <Button onClick={() => navigate("/prompt-generator")}>Open the project</Button>
              <Button onClick={run.reset}>Start over</Button>
            </div>
          )}

          {busy && (
            <div>
              <Button variant="danger" icon={Square} onClick={run.cancel}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
