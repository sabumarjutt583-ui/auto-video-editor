import { cn } from "../../lib/cn";
import type { KeyStatusValue } from "../../store/keyStore";

const BADGES: Record<KeyStatusValue, { label: string; dot: string; text: string }> = {
  set: { label: "Key saved", dot: "bg-success", text: "text-success" },
  not_set: { label: "No key saved", dot: "bg-muted", text: "text-muted" },
  unknown: { label: "Checking…", dot: "bg-muted animate-pulse", text: "text-muted" },
};

export function KeyStatusBadge({ status }: { status: KeyStatusValue }) {
  const badge = BADGES[status];
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium", badge.text)}>
      <span aria-hidden className={cn("h-2 w-2 rounded-full", badge.dot)} />
      {badge.label}
    </span>
  );
}
