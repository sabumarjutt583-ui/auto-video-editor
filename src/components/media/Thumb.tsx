import { Clapperboard, Image as ImageIcon } from "lucide-react";

import { cn } from "../../lib/cn";
import { useThumbStore } from "../../store/thumbStore";
import type { MediaFile } from "../../types";

interface ThumbProps {
  file: Pick<MediaFile, "path" | "kind" | "name">;
  className?: string;
}

/** A small preview picture of a file, or an icon while there is none. */
export function Thumb({ file, className }: ThumbProps) {
  const url = useThumbStore((state) => state.urls[file.path]?.[0]);
  const Icon = file.kind === "video" ? Clapperboard : ImageIcon;
  return (
    <div className={cn("relative flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted", className)}>
      {url ? <img src={url} alt={file.name} loading="lazy" className="h-full w-full object-cover" /> : <Icon size={18} aria-hidden />}
      {file.kind === "video" && url && <Clapperboard size={12} aria-label="clip" className="absolute right-1 bottom-1 text-white drop-shadow" />}
    </div>
  );
}
