import { useQueueStore } from "../store/queueStore";

import { Counters, QueuePanel, useChannelData } from "../components/channels";
import { DashboardVideoCard } from "../components/dashboard";
import { ErrorNotice } from "../components/ErrorNotice";
import { useConsent } from "../components/imagegen/useConsent";
import { useProfiles } from "../components/pipeline";
import { countVideos, recentlyFinished, videoState } from "../lib/pipeline/dashboard";

/** Active and interrupted productions, with the shared video queue. */
export function DashboardPage() {
  const data = useChannelData();
  const profiles = useProfiles();
  const { ensure, dialog } = useConsent();

  const attention = data.projects.filter((project) => {
    const state = videoState(project, data.active);
    return state !== "empty" && state !== "finished";
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const queued = useQueueStore((state) => state.items.some((item) => item.status !== "done"));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {dialog}
      {data.error && <ErrorNotice error={data.error} />}
      {data.run.error && <ErrorNotice error={data.run.error} />}
      <Counters counts={countVideos(data.projects, data.active)} />
      <section aria-label="Projects in production" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Projects in production <span className="text-muted">({attention.length})</span></h3>
        {attention.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No videos are in production. Start a video from Channels & Prompts.</p>
        ) : (
          attention.map((video) => (
            <DashboardVideoCard
              key={video.id}
              video={video}
              state={videoState(video, data.active)}
              channelName={profiles.profiles.find((profile) => profile.id === video.channelId)?.name ?? "No channel"}
              profile={profiles.profiles.find((profile) => profile.id === video.channelId) ?? null}
              busy={data.run.running}
              ensureConsent={ensure}
            />
          ))
        )}
      </section>

      {queued && <section aria-label="Video queue" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Video queue</h3>
        <QueuePanel channelId={null} channelName={(id) => profiles.profiles.find((p) => p.id === id)?.name ?? "No channel"} ensureConsent={ensure} />
      </section>}

      {recentlyFinished(data.projects).length > 0 && <section className="flex flex-col gap-3" aria-label="Recently finished">
        <h3 className="text-sm font-semibold">Recently finished</h3>
        {recentlyFinished(data.projects).map(video => <DashboardVideoCard key={video.id} video={video} state="finished" channelName={profiles.profiles.find(p => p.id === video.channelId)?.name ?? "No channel"} profile={profiles.profiles.find(p => p.id === video.channelId) ?? null} busy={data.run.running} ensureConsent={ensure} />)}
      </section>}
    </div>
  );
}
