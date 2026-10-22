import { Clapperboard, Copy, Image as ImageIcon, Pencil, RefreshCw } from "lucide-react";

import { timecodeOf } from "../../lib/prompts/export";
import type { Scene } from "../../types";
import { IconButton } from "../ui";

const AREA =
  "w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-accent";

interface PromptRowProps {
  scene: Scene;
  showMotion: boolean;
  busy: boolean;
  onPrompt: (text: string) => void;
  onMotion: (text: string) => void;
  onRegenerate: () => void;
  onCopy: () => void;
}

/** One scene: timecode ID, length, media, narration, editable prompt and motion. */
export function PromptRow({ scene, showMotion, busy, onPrompt, onMotion, onRegenerate, onCopy }: PromptRowProps) {
  const MediaIcon = scene.mediaType === "video" ? Clapperboard : ImageIcon;
  return (
    <li className="rounded-xl border border-line bg-surface-2 p-3" data-testid="prompt-row">
      <div className="grid grid-cols-[minmax(11rem,13rem)_1fr_auto] items-start gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tabular-nums">{timecodeOf(scene)}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <MediaIcon size={13} aria-label={scene.mediaType} />
            {scene.duration > 0 && `${scene.duration.toFixed(1)} s`}
            {(scene.fixNotes ?? []).length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-fg" title={(scene.fixNotes ?? []).join("\n")}>
                {(scene.fixNotes ?? []).some((n) => !n.startsWith("check:")) ? "fixed" : "check"}
              </span>
            )}
            {scene.edited && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-fg" title="You edited this prompt. It is kept when you regenerate all.">
                <Pencil size={10} aria-hidden /> edited
              </span>
            )}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p dir="auto" className="px-2 text-xs text-muted">
            {scene.text}
          </p>
          <textarea
            aria-label={`Prompt of ${scene.id}`}
            rows={Math.max(2, Math.min(8, Math.ceil(scene.prompt.length / 110)))}
            value={scene.prompt}
            placeholder="No prompt yet."
            onChange={(event) => onPrompt(event.target.value)}
            className={AREA}
          />
          {showMotion && (
            <textarea aria-label={`Motion prompt of ${scene.id}`} rows={2} value={scene.motionPrompt} placeholder="No motion prompt yet." onChange={(event) => onMotion(event.target.value)} className={`${AREA} text-muted`} />
          )}
        </div>
        <div className="flex gap-1">
          <IconButton icon={RefreshCw} label={`Regenerate ${scene.id}`} disabled={busy} onClick={onRegenerate} />
          <IconButton icon={Copy} label={`Copy ${scene.id}`} disabled={scene.prompt.trim() === ""} onClick={onCopy} />
        </div>
      </div>
    </li>
  );
}
