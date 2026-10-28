import { Film, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { buildVideoItems, hasVideo, parseVideoSource } from "../../lib/imagegen/video";
import { formatTimecode } from "../../lib/scenes/timecode";
import type { Project } from "../../types";
import type { VideoSource } from "../../types/imagegen";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Checkbox } from "../ui";
import { FlowBatchVideoRun } from "./FlowBatchVideoRun";
import { useVideoMaker } from "./useVideoMaker";

function clock(ms: number): string {
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const SOURCE_KEY = "videoSource";

// "flow" is the stored id for the Flow slot, but it now means Batch
// Flow Studio: the old one-video-at-a-time Google Flow engine is no
// longer offered, and "auto" (Flow first) is no longer offered either
// — a stored "auto" value is read as Batch, so old choices keep
// working without silently running the deprecated engine.
const SOURCES: ReadonlyArray<{ id: VideoSource; label: string; note: string }> = [
  { id: "flow", label: "Batch Flow Studio", note: "Batch Flow Studio inside Google Flow (shared link only): all selected scenes as one paragraph batch, Omni 1.1 Flash by default, credits per video from the live table, downloads S01.mp4 renamed to timecode names. A clip lasts only the chosen duration (4s–10s)." },
  { id: "gemini", label: "Gemini", note: "Gemini's \"Create video\": a few videos a day per account." },
];

function storedSource(): VideoSource {
  try {
    const value = parseVideoSource(localStorage.getItem(SOURCE_KEY));
    return value === "auto" ? "flow" : value;
  } catch {
    return "flow";
  }
}

/** "Videos": makes a short video for chosen scenes with Batch Flow Studio (in Flow's place) or Gemini. */
export function VideoPanel({ project, ensureConsent }: { project: Project; ensureConsent: () => Promise<boolean> }) {
  const [source, setSource] = useState<VideoSource>(storedSource);
  // The Gemini maker is only used for Gemini; Batch runs through
  // FlowBatchVideoRun below, never through the old Flow maker.
  const maker = useVideoMaker(project.id, source === "flow" ? "gemini" : source, ensureConsent);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(project.scenes.filter((s) => s.mediaType === "video" && !hasVideo(s, project.mediaMap)).map((s) => s.id)));
  const [animate, setAnimate] = useState(true);
  const [skipDone, setSkipDone] = useState(true);
  const [keepGoing, setKeepGoing] = useState(true);
  const scenes = useMemo(() => [...project.scenes].sort((a, b) => a.index - b.index), [project.scenes]);
  // Batch videos are made from words (Text to Video), so the
  // animate-picture wording is never sent to Batch; Gemini keeps it.
  const items = useMemo(() => buildVideoItems(scenes, project.mediaMap, { only: selected, animatePictures: source === "flow" ? false : animate, skipDone }), [scenes, project.mediaMap, selected, animate, skipDone, source]);
  const { status } = maker;

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5" aria-label="Videos">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Film size={18} aria-hidden /> Videos (no API key)
        </h2>
        <p className="text-sm text-muted">
          {source === "flow"
            ? "Batch Flow Studio makes all selected scenes as one batch in a tab of a Google account's browser. An account with no credits left stops the batch; it never bypasses a limit."
            : "Each Google account makes one video at a time. An account with no videos or credits left rests, and the other accounts carry on."}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1" role="radiogroup" aria-label="Where to make the videos">
          {SOURCES.map((option) => (
            <Button
              key={option.id}
              variant={source === option.id ? "primary" : undefined}
              disabled={maker.running}
              onClick={() => {
                setSource(option.id);
                try {
                  localStorage.setItem(SOURCE_KEY, option.id);
                } catch {
                  /* a private window: the choice is only kept for now */
                }
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted">{SOURCES.find((o) => o.id === source)?.note}</p>
        {source !== "flow" && status && (
          <p className="text-sm" role="status">
            {status.ready} {status.ready === 1 ? "account" : "accounts"} can make videos now
            {status.resting > 0 && `, ${status.resting} out of videos (first one is back ${status.backAt > 0 ? clock(status.backAt) : "later"})`}.
          </p>
        )}
      </div>

      {source !== "flow" && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Checkbox label="Animate the scene's picture when it has one" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
          <Checkbox label="Skip scenes that already have a video" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} />
          <Checkbox label="Keep going when accounts come back" checked={keepGoing} onChange={(e) => setKeepGoing(e.target.checked)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setSelected(new Set(scenes.filter((s) => s.mediaType === "video").map((s) => s.id)))}>Scenes marked as video</Button>
        <Button onClick={() => setSelected(new Set(scenes.map((s) => s.id)))}>All scenes</Button>
        <Button onClick={() => setSelected(new Set())}>None</Button>
        {source === "flow" ? null : maker.running ? (
          <Button variant="danger" icon={Square} onClick={maker.stop}>
            Stop after the running videos
          </Button>
        ) : (
          <Button variant="primary" icon={Film} disabled={items.length === 0} onClick={() => void maker.start(items, keepGoing)}>
            Make {items.length} {items.length === 1 ? "video" : "videos"}
          </Button>
        )}
      </div>

      {source === "flow" && <FlowBatchVideoRun project={project} items={items} ensureConsent={ensureConsent} />}

      {source !== "flow" && maker.running && <p className="text-sm text-muted" role="status">{maker.waitingFor !== null ? `Every account is out of videos. Waiting until ${clock(maker.waitingFor)}.` : "Making videos. One video takes about 1 to 3 minutes. You can leave this page open in the background."}</p>}
      {source !== "flow" && maker.summary && <p className="text-sm" role="status">{maker.summary}</p>}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {scenes.map((scene) => {
          const state = source === "flow" ? undefined : maker.states[scene.id];
          const label = state?.kind === "making" ? "making…" : state?.kind === "queued" ? "waiting" : state?.kind === "done" ? "done" : state?.kind === "failed" ? "failed" : hasVideo(scene, project.mediaMap) ? "has video" : "";
          return (
            <li key={scene.id} className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2 text-sm">
              <Checkbox label={`${formatTimecode(scene.id, scene.start, scene.end)}${label ? ` · ${label}` : ""}`} checked={selected.has(scene.id)} onChange={(e) => toggle(scene.id, e.target.checked)} disabled={maker.running} />
              {state?.kind === "failed" && <ErrorNotice error={state.error} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
