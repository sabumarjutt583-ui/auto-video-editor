import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";

import { formatClock } from "../../lib/time";
import { useThemeStore } from "../../store/themeStore";
import type { TimeRange } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { useProjectAudio } from "./useProjectAudio";

interface WaveformPlayerProps {
  projectId: string;
  /** Project file to show, e.g. "audio/processed.wav". */
  path: string;
  /** Change this to reload the file after it was rebuilt. */
  version: number;
  /** Stretches to shade on the waveform (the silences that will be removed). */
  shaded?: readonly TimeRange[];
  /** Called while playing and after seeking, with the position in seconds. */
  onTime?: (seconds: number) => void;
  /** Jump to this time and play. A new `nonce` makes the same time jump again. */
  seek?: { time: number; nonce: number } | null;
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** Waveform with a play/pause button and the current time. */
export function WaveformPlayer({ projectId, path, version, shaded = [], onTime, seek = null }: WaveformPlayerProps) {
  const theme = useThemeStore((state) => state.theme);
  const { url, waveform, error } = useProjectAudio(projectId, path, version);
  const container = useRef<HTMLDivElement>(null);
  const regions = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const player = useRef<WaveSurfer | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    if (!url || !waveform || !container.current) return;
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    const plugin = RegionsPlugin.create();
    const surfer = WaveSurfer.create({
      container: container.current,
      media: audio,
      peaks: [Float32Array.from(waveform.peaks)],
      duration: waveform.duration,
      height: 112,
      normalize: true,
      waveColor: cssColor("--text-muted", "#9797ae"),
      progressColor: cssColor("--accent", "#8b5cf6"),
      cursorColor: cssColor("--text", "#ececf4"),
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [plugin],
    });
    regions.current = plugin;
    player.current = surfer;
    setTime(0);
    setPlaying(false);
    setPlayError(null);
    surfer.on("timeupdate", (seconds) => {
      setTime(seconds);
      onTimeRef.current?.(seconds);
    });
    surfer.on("play", () => setPlaying(true));
    surfer.on("pause", () => setPlaying(false));
    surfer.on("finish", () => setPlaying(false));
    // Some systems (WebKitGTK on Linux) cannot stream audio from the app's file protocol.
    // Then the whole file is read once and played from memory instead.
    let objectUrl: string | null = null;
    let triedMemory = false;
    const playFromMemory = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        audio.src = objectUrl;
        audio.load();
      } catch (failure: unknown) {
        setPlayError(`This computer could not play the audio file (${failure instanceof Error ? failure.message : String(failure)}).`);
      }
    };
    audio.addEventListener("canplay", () => setPlayError(null));
    audio.addEventListener("error", () => {
      if (!triedMemory) {
        triedMemory = true;
        void playFromMemory();
        return;
      }
      const reason = audio.error ? ` (code ${audio.error.code}${audio.error.message ? `: ${audio.error.message}` : ""})` : "";
      setPlayError(`This computer could not play the audio file${reason}.`);
    });
    return () => {
      surfer.destroy();
      audio.pause();
      audio.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      regions.current = null;
      player.current = null;
    };
  }, [url, waveform, theme]);

  // Jump when a new position is requested (for example, a sentence was clicked).
  useEffect(() => {
    const surfer = player.current;
    if (!seek || !surfer || !waveform) return;
    surfer.setTime(Math.max(0, Math.min(seek.time, waveform.duration)));
    onTimeRef.current?.(seek.time);
    void surfer.play().catch(() => undefined);
  }, [seek, waveform]);

  // Shade the silences that would be removed.
  useEffect(() => {
    const plugin = regions.current;
    if (!plugin) return;
    plugin.clearRegions();
    const color = cssColor("--danger", "#f87171");
    for (const range of shaded) {
      plugin.addRegion({
        start: range.start,
        end: range.end,
        color: `color-mix(in srgb, ${color} 35%, transparent)`,
        drag: false,
        resize: false,
      });
    }
  }, [shaded, url, waveform, theme]);

  if (error) return <ErrorNotice error={error} />;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={container}
        data-testid="waveform"
        className="min-h-[112px] overflow-hidden rounded-xl border border-line bg-surface-2 px-2 py-1"
      >
        {!waveform && <p className="p-8 text-center text-sm text-muted">Drawing the waveform…</p>}
      </div>
      <div className="flex items-center gap-3">
        <Button
          icon={playing ? Pause : Play}
          disabled={!waveform}
          onClick={() =>
            void player.current?.playPause().catch((failure: unknown) => {
              const media = player.current?.getMediaElement();
              const state = media ? ` [network ${media.networkState}, ready ${media.readyState}, error ${media.error?.code ?? "none"}]` : "";
              setPlayError(`This computer could not play the audio file: ${failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)}${state}`);
            })
          }
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <p className="font-mono text-sm tabular-nums text-muted" aria-label="Current time">
          {formatClock(time, 1)} / {formatClock(waveform?.duration ?? 0, 1)}
        </p>
        {playError && <p className="text-xs text-danger">{playError}</p>}
      </div>
    </div>
  );
}
