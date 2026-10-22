import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, X } from "lucide-react";

import { MAX_IMAGES, MIN_IMAGES } from "../../../lib/customStyle/model";
import { cn } from "../../../lib/cn";
import type { PreparedImage } from "../../../types";
import { IconButton } from "../../ui";

interface ReferencePicturesProps {
  images: readonly PreparedImage[];
  /** A picture is being dragged over the window. */
  dragging: boolean;
  disabled: boolean;
  onChoose: () => void;
  onRemove: (index: number) => void;
  /** Hide the drop place and the remove buttons (the pictures are only shown). */
  readOnly?: boolean;
}

/** The reference pictures as small cards with a remove button, and a place to drop or choose more. */
export function ReferencePictures({ images, dragging, disabled, onChoose, onRemove, readOnly = false }: ReferencePicturesProps) {
  const full = images.length >= MAX_IMAGES;
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Reference pictures">
        {images.map((image, index) => (
          <li key={image.path} className="group relative overflow-hidden rounded-lg border border-line bg-surface-2">
            <div className="aspect-[4/3]">
              <img src={convertFileSrc(image.path)} alt={`Reference picture ${index + 1}: ${image.name}`} className="h-full w-full object-cover" draggable={false} />
            </div>
            <p className="truncate px-2 py-1 text-xs text-muted" title={image.name}>
              {image.name}
            </p>
            {!readOnly && (
              <IconButton icon={X} label={`Remove ${image.name}`} onClick={() => onRemove(index)} disabled={disabled} className="absolute top-1 right-1 bg-surface/80" />
            )}
          </li>
        ))}
        {!readOnly && !full && (
          <li className="flex">
            <button
              type="button"
              onClick={onChoose}
              disabled={disabled}
              className={cn(
                "flex min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 text-center text-xs text-muted transition-colors hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-60",
                dragging ? "border-accent bg-accent-soft text-fg" : "border-line",
              )}
            >
              <ImagePlus size={22} aria-hidden />
              Drop pictures here or click to choose
            </button>
          </li>
        )}
      </ul>
      <p className={cn("text-xs", images.length >= MIN_IMAGES ? "text-muted" : "text-warning")} role="status">
        {images.length} of {MAX_IMAGES} pictures{images.length < MIN_IMAGES ? ` (add at least ${MIN_IMAGES})` : ""}. PNG, JPG or WebP, up to 10 MB each.
      </p>
    </div>
  );
}
