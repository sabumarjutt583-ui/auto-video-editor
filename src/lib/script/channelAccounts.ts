import type { ChannelProfile } from "../pipeline/profile.ts";

/** The order accounts are tried for a channel: the channel's picked account first, then the rest in list order. */
export function orderAccountIds(preferred: string | null | undefined, ids: readonly string[]): string[] {
  if (!preferred) return [...ids];
  const rest = ids.filter((id) => id !== preferred);
  return ids.includes(preferred) ? [preferred, ...rest] : [...ids];
}

/** Names of the channels that picked this Claude account (exact channel-id match). */
export function channelsUsingAccount(profiles: readonly ChannelProfile[], accountId: string): string[] {
  return profiles.filter((p) => p.script.claudeAccountId === accountId).map((p) => p.name);
}
