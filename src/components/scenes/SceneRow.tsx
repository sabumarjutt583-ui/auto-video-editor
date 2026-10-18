import { Merge, Scissors } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn";
import { LONG_IMAGE_SECONDS } from "../../lib/scenes/edit";
import { formatTimecode } from "../../lib/scenes/timecode";
import type { Boundary } from "../../lib/scenes/video";
import type { Character, Location, MediaType, Scene, Word } from "../../types";
import { IconButton, Select } from "../ui";

interface SceneRowProps {
  scene: Scene;
  words: readonly Word[];
  isLast: boolean;
  choices: Boundary[];
  characters: readonly Character[];
  locations: readonly Location[];
  onToggleCharacter: (id: string) => void;
  onLocation: (id: string | null) => void;
  onMedia: (type: MediaType) => void;
  onMerge: () => void;
  onSplit: (wordIndex: number) => void;
  onText: (text: string) => void;
}

function preview(words: readonly Word[], from: number): string {
  return words
    .slice(from, from + 5)
    .map((word) => word.text)
    .join(" ");
}

/** One scene: timecode, length, editable text, image/video toggle, merge and split. */
export function SceneRow({ scene, words, isLast, choices, characters, locations, onToggleCharacter, onLocation, onMedia, onMerge, onSplit, onText }: SceneRowProps) {
  const [splitting, setSplitting] = useState(false);
  const longImage = scene.mediaType === "image" && scene.duration > LONG_IMAGE_SECONDS;

  return (
    <li className="rounded-xl border border-line bg-surface-2 p-3" data-testid="scene-row">
      <div className="grid grid-cols-[minmax(11rem,13rem)_4.5rem_1fr_auto] items-start gap-3">
        <div className="font-mono text-xs leading-6 tabular-nums">{formatTimecode(scene.id, scene.start, scene.end)}</div>
        <div className={cn("text-sm leading-6 tabular-nums", longImage ? "font-medium text-warning" : "text-muted")} title={longImage ? "An image this long may feel static. Consider splitting it." : undefined}>
          {scene.duration.toFixed(1)} s
        </div>
        <textarea
          aria-label={`Text of ${scene.id}`}
          dir="auto"
          rows={Math.max(1, Math.min(5, Math.ceil(scene.text.length / 90)))}
          value={scene.text}
          onChange={(event) => onText(event.target.value)}
          className="w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-sm hover:border-line focus:border-accent"
        />
        <div className="flex items-center gap-1">
          <div role="radiogroup" aria-label={`Media of ${scene.id}`} className="mr-1 inline-flex gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            {(["image", "video"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={scene.mediaType === type}
                onClick={() => onMedia(type)}
                className={cn("h-7 cursor-pointer rounded-md px-2.5 text-xs font-medium capitalize", scene.mediaType === type ? "bg-accent text-on-accent" : "text-muted hover:text-fg")}
              >
                {type}
              </button>
            ))}
          </div>
          <IconButton icon={Merge} label={`Merge ${scene.id} with the next scene`} disabled={isLast} onClick={onMerge} />
          <IconButton icon={Scissors} label={`Split ${scene.id}`} disabled={choices.length === 0} onClick={() => setSplitting((open) => !open)} />
        </div>
      </div>
      {(characters.length > 0 || locations.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1" aria-label={`Cast of ${scene.id}`}>
          {characters.map((character) => {
            const on = scene.characterIds.includes(character.id);
            return (
              <button
                key={character.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleCharacter(character.id)}
                className={cn("h-6 cursor-pointer rounded-full border px-2.5 text-xs", on ? "border-accent bg-accent-soft text-accent-fg" : "border-line text-muted hover:text-fg")}
              >
                {character.name || character.id}
              </button>
            );
          })}
          {locations.length > 0 && (
            <select
              aria-label={`Location of ${scene.id}`}
              value={scene.locationId ?? ""}
              onChange={(event) => onLocation(event.target.value === "" ? null : event.target.value)}
              className="h-6 cursor-pointer rounded-full border border-line bg-surface px-2 text-xs text-muted"
            >
              <option value="">No location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name || location.id}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {splitting && (
        <div className="mt-2 flex items-center gap-2 pl-1">
          <span className="text-xs text-muted">Start a new scene at:</span>
          <div className="w-96 max-w-full">
            <Select
              aria-label={`Where to split ${scene.id}`}
              value=""
              onChange={(event) => {
                if (event.target.value === "") return;
                setSplitting(false);
                onSplit(Number(event.target.value));
              }}
            >
              <option value="">Choose a place…</option>
              {choices.map((choice) => (
                <option key={choice.wordIndex} value={choice.wordIndex}>
                  {(words[choice.wordIndex]?.start ?? 0).toFixed(1)} s · {preview(words, choice.wordIndex)}…
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </li>
  );
}
