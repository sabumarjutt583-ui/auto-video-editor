import { Images } from "lucide-react";

import type { StyleProfile } from "../../types";
import { Button } from "../ui";
import { StyleThumbnail } from "./StyleThumbnail";

interface StyleCurrentCardProps {
  style: StyleProfile | null;
  onChange: () => void;
}

/** The style in use as a small card: picture on the left, name and category on the right, and a button to change it. */
export function StyleCurrentCard({ style, onChange }: StyleCurrentCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-2 p-3" data-testid="current-style">
      {style ? (
        <StyleThumbnail style={style} className="w-32 shrink-0" />
      ) : (
        <div className="flex aspect-[4/3] w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-muted">
          <Images size={26} aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold">{style ? style.name : "No style chosen yet"}</p>
        <p className="truncate text-sm text-muted">{style ? style.category : "Pick the look of your pictures."}</p>
      </div>
      <Button variant={style ? "secondary" : "primary"} icon={Images} onClick={onChange}>
        {style ? "Change style" : "Choose a style"}
      </Button>
    </div>
  );
}
