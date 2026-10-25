import { useMemo } from "react";

import { videoState, type ActiveRun } from "../../lib/pipeline/dashboard";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import type { ProjectSummary } from "../../types";
import { usePipelineStore } from "../../store/pipelineStore";
import type { ConsentFn } from "./types";
import { VideoRow } from "./VideoRow";

interface Props {
  videos: readonly ProjectSummary[];
  profiles: readonly ChannelProfile[];
  active: ActiveRun;
  ensureConsent: ConsentFn;
  /** Show the channel name on each row. */
  showChannel?: boolean;
  empty: string;
}

/** Videos with their buttons wired to the pipeline store. */
export function VideoList({ videos, profiles, active, ensureConsent, showChannel = false, empty }: Props) {
  const run = usePipelineStore();
  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  if (videos.length === 0) return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      {videos.map((video) => {
        const profile = byId.get(video.channelId) ?? null;
        return (
          <VideoRow
            key={video.id}
            video={video}
            state={videoState(video, active)}
            channelName={showChannel ? (profile?.name ?? "No channel") : undefined}
            profile={profile}
            busy={run.running}
            onContinue={(v, p) => void run.continueProject(v.id, p, ensureConsent)}
            onCancel={run.cancel}
            onAnswer={run.answer}
          />
        );
      })}
    </div>
  );
}
