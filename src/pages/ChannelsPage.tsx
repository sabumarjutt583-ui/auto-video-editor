import { Plus, Upload, Tv } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ChannelCard } from "../components/channels/ChannelCard";
import { Counters, VideoList, useChannelData } from "../components/channels";
import { ErrorNotice } from "../components/ErrorNotice";
import { useConsent } from "../components/imagegen/useConsent";
import { useProfiles } from "../components/pipeline";
import { Button } from "../components/ui";
import { pickFile } from "../lib/dialog";
import { toAppError } from "../lib/errors";
import { countVideos, needAttention, recentlyFinished } from "../lib/pipeline/dashboard";
import { defaultProfile, importProfile, newProfileId } from "../lib/pipeline/profile";
import { NO_CHANNEL } from "../lib/pipeline/channels";
import { readTextFile } from "../lib/timing/api";
import type { AppError } from "../types";

/** All channels at a glance: the totals, each channel, what is being made now and what is finished. */
export function ChannelsPage() {
  const navigate = useNavigate();
  const profiles = useProfiles();
  const data = useChannelData();
  const { ensure, dialog } = useConsent();
  const [error, setError] = useState<AppError | null>(null);

  const known = useMemo(() => new Set(profiles.profiles.map((p) => p.id)), [profiles.profiles]);
  const orphans = useMemo(() => data.projects.filter((p) => !known.has(p.channelId)), [data.projects, known]);
  const totals = countVideos(data.projects, data.active);
  const attention = needAttention(data.projects, data.active);
  const finished = recentlyFinished(data.projects);

  function addChannel() {
    const profile = defaultProfile(newProfileId(profiles.profiles), "New channel");
    profiles.save(profile);
    navigate(`/channels/${profile.id}?tab=settings`);
  }

  async function importChannel() {
    setError(null);
    try {
      const path = await pickFile("Choose a channel profile", "Channel profile", ["avprofile", "json"]);
      if (!path) return;
      const profile = importProfile(await readTextFile(path), profiles.profiles);
      if (!profile) {
        setError({ message: "That file is not a channel profile.", details: `Not a profile file: ${path}` });
        return;
      }
      profiles.save(profile);
      navigate(`/channels/${profile.id}`);
    } catch (caught) {
      setError(toAppError(caught, "The profile could not be read."));
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Channels</h2>
          <p className="text-sm text-muted">Every channel and every video, and where each one is right now.</p>
        </div>
        <div className="flex gap-2">
          <Button icon={Upload} onClick={() => void importChannel()}>
            Import
          </Button>
          <Button variant="primary" icon={Plus} onClick={addChannel}>
            New channel
          </Button>
        </div>
      </div>

      {error && <ErrorNotice error={error} />}
      {data.error && <ErrorNotice error={data.error} />}
      <Counters counts={totals} />

      <section aria-label="Channels" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Your channels</h3>
        {profiles.profiles.length === 0 && orphans.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
            <Tv size={28} className="text-muted" aria-hidden />
            <p className="max-w-md text-sm text-muted">A channel keeps the voice, style, captions and music of one YouTube channel. Make it once, then every video is one button.</p>
            <Button variant="primary" icon={Plus} onClick={addChannel}>
              Create the first channel
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.profiles.map((profile) => {
              const own = data.projects.filter((p) => p.channelId === profile.id);
              return (
                <ChannelCard
                  key={profile.id}
                  to={`/channels/${profile.id}`}
                  name={profile.name}
                  detail={`${own.length} ${own.length === 1 ? "video" : "videos"} · ${profile.aspect} · ${profile.quality}`}
                  counts={countVideos(own, data.active)}
                />
              );
            })}
            {orphans.length > 0 && (
              <ChannelCard to={`/channels/${NO_CHANNEL}`} name="No channel" detail={`${orphans.length} older ${orphans.length === 1 ? "project" : "projects"}`} counts={countVideos(orphans, data.active)} />
            )}
          </div>
        )}
      </section>

      <section aria-label="Videos being made" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Being made or waiting</h3>
        <VideoList videos={attention} profiles={profiles.profiles} active={data.active} ensureConsent={ensure} showChannel empty="Nothing is being made right now." />
      </section>

      {finished.length > 0 && (
        <section aria-label="Finished videos" className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Latest finished videos</h3>
          <VideoList videos={finished} profiles={profiles.profiles} active={data.active} ensureConsent={ensure} showChannel empty="" />
        </section>
      )}
    </div>
  );
}
