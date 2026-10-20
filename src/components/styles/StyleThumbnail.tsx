import { convertFileSrc } from "@tauri-apps/api/core";
import { useState } from "react";

import { cn } from "../../lib/cn";
import { thumbnailView } from "../../lib/styleThumbnails";
import type { StyleProfile } from "../../types";

interface StyleThumbnailProps {
  style: Pick<StyleProfile, "name" | "thumbnail" | "color_palette">;
  /** Sizing classes; the picture always fills a 4:3 box. */
  className?: string;
  /** Zoom slightly while a parent with the `group` class is hovered. */
  zoom?: boolean;
}

/** The picture of a style, or a generated card with its first letter when there is no picture (or it cannot be loaded). */
export function StyleThumbnail({ style, className, zoom = false }: StyleThumbnailProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const view = thumbnailView(style, failedFor === style.thumbnail, convertFileSrc);
  return (
    <div className={cn("relative aspect-[4/3] overflow-hidden rounded-lg bg-surface-2", className)}>
      {view.kind === "image" ? (
        <img
          src={view.src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedFor(style.thumbnail)}
          className={cn("h-full w-full object-cover transition-transform duration-300", zoom && "group-hover:scale-105")}
        />
      ) : (
        <div
          aria-hidden
          className={cn("flex h-full w-full items-center justify-center transition-transform duration-300", zoom && "group-hover:scale-105")}
          style={{ backgroundImage: `linear-gradient(135deg, ${view.from}, ${view.to})` }}
        >
          <span className="text-4xl font-semibold text-white/90 drop-shadow">{view.letter}</span>
        </div>
      )}
    </div>
  );
}
