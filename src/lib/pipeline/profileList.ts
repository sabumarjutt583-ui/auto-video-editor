/** Changes to the list of channel profiles (pure, so the settings store only has to save the result). */

import type { ChannelProfile } from "./profile.ts";

export const MAX_PROFILES = 100;

/** Replaces the profile with the same id, or adds it at the end. Returns the same list when the limit is reached. */
export function upsertProfile(list: readonly ChannelProfile[], profile: ChannelProfile): ChannelProfile[] {
  const index = list.findIndex((p) => p.id === profile.id);
  if (index >= 0) return list.map((p, i) => (i === index ? profile : p));
  if (list.length >= MAX_PROFILES) return [...list];
  return [...list, profile];
}

export function removeProfile(list: readonly ChannelProfile[], id: string): ChannelProfile[] {
  return list.filter((p) => p.id !== id);
}

/** The profile that is chosen; when the saved id is gone, the first one (or null when there are none). */
export function chosenProfile(list: readonly ChannelProfile[], id: string): ChannelProfile | null {
  return list.find((p) => p.id === id) ?? list[0] ?? null;
}
