import { useCallback, useMemo } from "react";

import { chosenProfile } from "../../lib/pipeline/profileList";
import { removeProfile, upsertProfile } from "../../lib/pipeline/profileList";
import { readProfiles, type ChannelProfile } from "../../lib/pipeline/profile";
import { useSettingsStore } from "../../store/settingsStore";

export interface ProfilesView {
  profiles: ChannelProfile[];
  chosen: ChannelProfile | null;
  /** Saves (adds or replaces) a profile and chooses it. */
  save: (profile: ChannelProfile) => void;
  saveNow: (profile: ChannelProfile) => Promise<void>;
  remove: (id: string) => void;
  choose: (id: string) => void;
}

/** The channel profiles kept in the app settings. */
export function useProfiles(): ProfilesView {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const raw = settings?.channelProfiles;
  const profiles = useMemo(() => readProfiles(raw ?? []), [raw]);
  const chosen = chosenProfile(profiles, settings?.channelProfileId ?? "");

  const save = useCallback(
    (profile: ChannelProfile) => update({ channelProfiles: upsertProfile(profiles, profile), channelProfileId: profile.id }),
    [profiles, update],
  );
  const remove = useCallback(
    (id: string) => {
      const rest = removeProfile(profiles, id);
      update({ channelProfiles: rest, channelProfileId: rest[0]?.id ?? "" });
    },
    [profiles, update],
  );
  const choose = useCallback((id: string) => update({ channelProfileId: id }), [update]);
  const saveNow = useCallback(async (profile: ChannelProfile) => {
    const store = useSettingsStore.getState();
    if (!store.settings) throw new Error("Settings have not loaded yet. Try again once the app is ready.");
    // Read the latest profiles so saving one channel cannot erase another channel's changes.
    store.update({ channelProfiles: upsertProfile(readProfiles(store.settings.channelProfiles ?? []), profile), channelProfileId: profile.id });
    if (!await useSettingsStore.getState().flush()) {
      throw useSettingsStore.getState().saveError ?? new Error("The channel settings could not be saved.");
    }
  }, []);
  return { profiles, chosen, save, saveNow, remove, choose };
}
