import { useMemo } from "react";

import { Counters, useChannelData } from "../components/channels";
import { ApprovalPanel, DashboardVideoCard } from "../components/dashboard";
import { ErrorNotice } from "../components/ErrorNotice";
import { useConsent } from "../components/imagegen/useConsent";
import { useProfiles } from "../components/pipeline";
import { countVideos, needAttention, recentlyFinished, videoState } from "../lib/pipeline/dashboard";
import { failedScenesFromProject } from "../lib/pipeline/failedScenes";
import { useProjectStore } from "../store/projectStore";

/** The brother tool's Dashboard, on this tool's own data: the three big numbers, the run that
waits for a review, the videos being made, and the latest finished videos.

The finished video's length and file size are left out on purpose: the project list does not
carry them (it carries only whether the video is rendered), so they are not guessed here. Open
the finished video itself to see its length and size. */
export function DashboardPage() {
  const data = useChannelData();
  const profiles = useProfiles();
  const { ensure, dialog } = useConsent();
  const openProject = useProjectStore((state) => state.project);

  const totals = countVideos(data.projects, data.active);
  const attention = needAttention(data.projects, data.active);
  const finished = recentlyFinished(data.projects);
  const runProfile = useMemo(() => profiles.profiles.find((profile) => profile.id === data.run.channelId) ?? null, [profiles.profiles, data.run.channelId]);
  const runProject = useMemo(() => data.projects.find((project) => project.id === data.run.projectId) ?? null, [data.projects, data.run.projectId]);
  const failed = openProject && data.run.projectId && openProject.id === data.run.projectId ? failedScenesFromProject(openProject) : [];
  const failedProjectName = openProject && data.run.projectId && openProject.id === data.run.projectId ? openProject.name : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {dialog}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted">Every video at a glance: what is being made, what waits for your review, and what is finished.</p>
      </div>

      {data.error && <ErrorNotice error={data.error} />}
      {data.run.error && <ErrorNotice error={data.run.error} />}
      <Counters counts={totals} />

      {data.run.projectId !== null && (
        <section aria-label="Pause for my review">
          <ApprovalPanel
            view={data.run.view}
            waiting={data.run.waiting}
            finished={data.run.finished}
            pauses={runProfile?.pauses ?? null}
            onPausesChange={runProfile ? (pauses) => profiles.save({ ...runProfile, pauses }) : undefined}
            onAnswer={data.run.answer}
            onResume={runProject ? () => void data.run.resume() : null}
            failedScenes={failed}
            failedProjectName={failedProjectName}
          />
        </section>
      )}

      <section aria-label="In progress" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">In progress</h3>
        {attention.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Nothing is being made right now.</p>
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

      {finished.length > 0 && (
        <section aria-label="Recently finished" className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Recently finished</h3>
          <p className="text-xs text-muted">The finished video&apos;s length and file size are not shown here, because the project list does not carry them.</p>
          {finished.map((video) => (
            <DashboardVideoCard
              key={video.id}
              video={video}
              state={videoState(video, data.active)}
              channelName={profiles.profiles.find((profile) => profile.id === video.channelId)?.name ?? "No channel"}
              profile={profiles.profiles.find((profile) => profile.id === video.channelId) ?? null}
              busy={data.run.running}
              ensureConsent={ensure}
            />
          ))}
        </section>
      )}
    </div>
  );
}
