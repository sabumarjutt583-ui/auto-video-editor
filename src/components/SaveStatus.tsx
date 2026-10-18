import { Check } from "lucide-react";

export type SaveStatusState = "idle" | "saving" | "saved" | "error";

interface SaveStatusProps {
  state: SaveStatusState;
}

/** Tiny status text: "Saving…", "Saved" or "Not saved". Shows nothing when idle. */
export function SaveStatus({ state }: SaveStatusProps) {
  return (
    <p aria-live="polite" className="h-5 shrink-0 text-xs font-medium">
      {state === "saving" && <span className="text-muted">Saving…</span>}
      {state === "saved" && (
        <span className="inline-flex items-center gap-1 text-success">
          <Check size={14} aria-hidden /> Saved
        </span>
      )}
      {state === "error" && <span className="text-danger">Not saved</span>}
    </p>
  );
}
