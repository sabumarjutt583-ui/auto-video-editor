import type { ReactNode } from "react";

interface TrackRowProps {
  label: string;
  height: string;
  children: ReactNode;
}

/** One horizontal track with its name on the left. */
export function TrackRow({ label, height, children }: TrackRowProps) {
  return (
    <div className="relative border-b border-line/60" style={{ height }} data-track={label}>
      {children}
    </div>
  );
}
