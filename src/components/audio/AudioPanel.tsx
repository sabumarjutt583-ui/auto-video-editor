import { AudioWaveform } from "lucide-react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { useProjectDir } from "../../lib/editor/useProjectDir";
import type { Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { JobBar } from "../voice/JobBar";
import { Button, Checkbox } from "../ui";
import { MusicSection } from "./MusicSection";
import { SfxSection } from "./SfxSection";
import type { AudioView } from "./useAudio";
import type { SfxLibraryView } from "./useSfxLibrary";

/** Editor tab: music, ducking, sound effects, and the final mix. */
export function AudioPanel({ project, view, library }: { project: Project; view: AudioView; library: SfxLibraryView }) {
  const dir = useProjectDir(project.id);
  const { mix } = view.audio;
  const url = dir && mix ? `${convertFileSrc(`${dir.replace(/[\\/]+$/, "")}/${mix.path}`)}?v=${encodeURIComponent(mix.builtAt)}` : null;
  const loud = mix ? Math.abs(mix.integrated + 14) <= 1.5 : false;

  return (
    <div className="flex flex-col gap-6" data-testid="audio-panel">
      <MusicSection view={view} />
      <hr className="border-line" />
      <SfxSection view={view} library={library} duration={project.voiceDuration} />
      <hr className="border-line" />
      <section className="flex flex-col gap-3" aria-label="Final audio">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <AudioWaveform size={16} aria-hidden /> Final audio
        </h3>
        <Checkbox label="Make it -14 LUFS (YouTube loudness), peak -1 dB" checked={view.audio.normalize} onChange={(e) => view.change({ normalize: e.target.checked })} />
        {view.job ? <JobBar job={view.job} /> : <Button variant="primary" icon={AudioWaveform} onClick={() => void view.build()} data-testid="build-mix">Build audio mix</Button>}
        {view.error && <ErrorNotice error={view.error} />}
        {view.notice && <p className="text-xs text-muted" role="status">{view.notice}</p>}
        {mix && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3 text-xs" data-testid="mix-result">
            <p>
              Loudness <strong>{mix.integrated.toFixed(1)} LUFS</strong> · true peak <strong>{mix.truePeak.toFixed(1)} dBTP</strong> · range {mix.range.toFixed(1)} LU
              {view.audio.normalize && <span className={loud ? " text-success" : " text-danger"}>{loud ? " ✓ on target" : " ✗ off target"}</span>}
            </p>
            {url && <audio controls src={url} className="w-full" />}
          </div>
        )}
      </section>
    </div>
  );
}
