import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useRef } from "react";

import { formatClock } from "../../lib/time";
import { sceneIndexAt } from "../../lib/editor/timeline";
import { usePlaybackStore } from "../../store/playbackStore";
import type { EditorData, Project } from "../../types";
import { IconButton } from "../ui";
import { frameSize } from "./preview/frameSize";
import { useCanvasPreview, type Overlay } from "./preview/useCanvasPreview";
import { usePlaybackControls } from "./usePlayback";

interface PreviewPlayerProps {
  project: Project;
  editor: EditorData;
  dir: string | null;
  overlay: Overlay | null;
}

function NarrationLine({ project }: { project: Project }) {
  const time = usePlaybackStore((state) => state.time);
  const scene = project.scenes[sceneIndexAt(project.scenes, time)];
  return (
    <p dir="auto" className="min-h-10 px-2 text-center text-sm text-muted" aria-live="off" data-testid="narration-line">
      {scene ? scene.text : ""}
    </p>
  );
}

function Clock({ duration }: { duration: number }) {
  const time = usePlaybackStore((state) => state.time);
  return (
    <span className="tabular-nums text-sm text-muted" data-testid="preview-clock">
      {formatClock(time)} / {formatClock(duration)}
    </span>
  );
}

/** The preview: the current picture or clip with its motion and captions, the voice, and the narration line. */
export function PreviewPlayer({ project, editor, dir, overlay }: PreviewPlayerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controls = usePlaybackControls();
  const playing = usePlaybackStore((state) => state.playing);
  const size = frameSize(project.settings.aspectRatio);
  useCanvasPreview(canvas, project, editor, dir, overlay);

  const jump = (direction: -1 | 1) => {
    const { time } = usePlaybackStore.getState();
    const index = sceneIndexAt(project.scenes, time);
    const scene = project.scenes[index];
    // "Previous" first goes back to the start of the current scene, then to the one before.
    const target = direction === 1 ? project.scenes[index + 1] : scene && time - scene.start > 0.5 ? scene : project.scenes[index - 1];
    controls.seek(target ? target.start : direction === 1 ? project.voiceDuration : 0);
  };

  return (
    <section className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-3" aria-label="Preview">
      <div className="flex w-full justify-center rounded-xl bg-black">
        <canvas
          ref={canvas}
          width={size.width}
          height={size.height}
          className="max-h-[min(360px,36vh)] w-auto max-w-full rounded-lg"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
          aria-label="Video preview"
          data-testid="preview-canvas"
        />
      </div>
      <NarrationLine project={project} />
      <div className="flex items-center gap-2">
        <IconButton icon={SkipBack} label="Previous scene" onClick={() => jump(-1)} />
        <IconButton icon={playing ? Pause : Play} label={playing ? "Pause (Space)" : "Play (Space)"} onClick={controls.toggle} className="h-10 w-10 bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent" />
        <IconButton icon={SkipForward} label="Next scene" onClick={() => jump(1)} />
        <Clock duration={project.voiceDuration} />
      </div>
    </section>
  );
}
