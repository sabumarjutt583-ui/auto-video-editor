import { Check, Info, Star } from "lucide-react";

import { cn } from "../../lib/cn";
import { firstSentence } from "../../lib/styleGallery";
import { isComplete } from "../../lib/styleModel";
import type { StyleProfile } from "../../types";
import { StyleThumbnail } from "./StyleThumbnail";

interface StyleCardProps {
  style: StyleProfile;
  index: number;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFavorite: () => void;
  onDetails: () => void;
}

/** One card of the gallery. The picture and name are one button; the star and Details are separate buttons. */
export function StyleCard({ style, index, selected, favorite, onSelect, onFavorite, onDetails }: StyleCardProps) {
  const complete = isComplete(style);
  return (
    <li
      className={cn(
        "group relative flex flex-col rounded-xl border bg-surface-2 p-2 transition-colors [contain-intrinsic-size:auto_220px] [content-visibility:auto]",
        selected ? "border-accent ring-2 ring-accent/60" : "border-line hover:border-accent/50",
        !complete && "opacity-55",
      )}
    >
      <button
        type="button"
        data-card-index={index}
        aria-pressed={selected}
        aria-disabled={!complete}
        title={firstSentence(style.core_identity) || (complete ? style.name : "This style is not finished yet.")}
        onClick={() => complete && onSelect()}
        className={cn("flex flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent", complete ? "cursor-pointer" : "cursor-not-allowed")}
      >
        <StyleThumbnail style={style} zoom={complete} />
        <span className="px-1">
          <span className="block truncate text-sm font-semibold">{style.name}</span>
          <span className="block truncate text-xs text-muted">{style.category}</span>
        </span>
      </button>

      {selected && (
        <span className="pointer-events-none absolute top-3.5 left-3.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white shadow" aria-label="Selected">
          <Check size={14} aria-hidden />
        </span>
      )}
      {!complete && <span className="pointer-events-none absolute top-3.5 left-3.5 rounded-full bg-warning/90 px-2 py-0.5 text-[10px] font-medium text-black">Incomplete</span>}
      {!style.builtin && complete && !selected && <span className="pointer-events-none absolute top-3.5 left-3.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">Custom</span>}

      <button
        type="button"
        onClick={onFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${style.name} from favorites` : `Add ${style.name} to favorites`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        className="absolute top-3.5 right-3.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
      >
        <Star size={15} aria-hidden className={favorite ? "fill-yellow-300 text-yellow-300" : ""} />
      </button>
      <button
        type="button"
        onClick={onDetails}
        aria-label={`Details of ${style.name}`}
        className="absolute right-3.5 bottom-3 inline-flex h-6 cursor-pointer items-center gap-1 rounded-full bg-surface px-2 text-[11px] text-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg"
      >
        <Info size={12} aria-hidden />
        Details
      </button>
    </li>
  );
}
