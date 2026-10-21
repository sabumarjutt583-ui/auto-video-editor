import type { AccountStatus, AccountView, ImageJob, JobStatus, Via } from "../../types/imagegen.ts";

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case "queued":
      return "Waiting";
    case "generating":
      return "Making…";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
  }
}

export function viaLabel(via: Via | null): string {
  switch (via) {
    case "free":
      return "Google account";
    case "gemini":
      return "Gemini API";
    case "cloudflare":
      return "Cloudflare API";
    case null:
      return "";
  }
}

/** "14:35" in the person's own time. */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_TEXT: Record<Exclude<AccountStatus, "limit_reached">, string> = {
  not_connected: "Not signed in",
  signed_out: "Signed out",
  paused: "Paused",
  flagged: "Needs your attention",
  unverified: "No access",
  signing_in: "Signing in…",
  checking: "Checking…",
  testing: "Making a test picture…",
  busy: "Working",
  ready: "Ready",
};

/** The status line of an account: "Ready", "Limit reached until 14:35", ... */
export function accountStatusLabel(account: Pick<AccountView, "status" | "cooldownUntil">): string {
  if (account.status === "limit_reached") return account.cooldownUntil > 0 ? `Limit reached until ${clock(account.cooldownUntil)}` : "Limit reached";
  return STATUS_TEXT[account.status];
}

export type Tone = "good" | "wait" | "bad" | "neutral";

export function accountTone(status: AccountStatus): Tone {
  switch (status) {
    case "ready":
    case "busy":
      return "good";
    case "limit_reached":
    case "signing_in":
    case "checking":
    case "testing":
      return "wait";
    case "signed_out":
    case "flagged":
    case "unverified":
      return "bad";
    default:
      return "neutral";
  }
}

/** A job the person can press "Retry" on. */
export function canRetry(job: Pick<ImageJob, "status">): boolean {
  return job.status === "failed";
}

/** The counters shown above the grid. */
export function counters(jobs: readonly Pick<ImageJob, "status">[]): { queued: number; generating: number; completed: number; failed: number } {
  const out = { queued: 0, generating: 0, completed: 0, failed: 0 };
  for (const job of jobs) out[job.status] += 1;
  return out;
}
