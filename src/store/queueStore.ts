import { create } from "zustand";

import { readQueue, nextWaiting, setItem, addScripts, addTopics, clearDone, removeItem, retryFailed, type QueueItem } from "../lib/pipeline/queue";
import { readProfiles, type ChannelProfile } from "../lib/pipeline/profile";
import { NO_PAUSES } from "../lib/pipeline/stages";
import { usePipelineStore } from "./pipelineStore";
import { useSettingsStore } from "./settingsStore";

const KEY = "videoQueue";

function load(): QueueItem[] {
  try {
    return readQueue(JSON.parse(window.localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function save(items: readonly QueueItem[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // The queue still works for this session.
  }
}

interface QueueState {
  items: QueueItem[];
  running: boolean;
  add: (channelId: string, fallbackName: string, parsed: { name: string; script: string }[]) => void;
  addTopics: (channelId: string, topics: string[]) => void;
  remove: (id: string) => void;
  clearDone: () => void;
  retryFailed: () => void;
  /** Makes the waiting videos one after another until none is left or Stop is pressed. */
  run: (ensureConsent: () => Promise<boolean>) => Promise<void>;
  stop: () => void;
}

let stopRequested = false;
let counter = 0;
const newId = () => `q${Date.now().toString(36)}${(counter += 1)}`;

function profileOf(id: string): ChannelProfile | null {
  const raw = useSettingsStore.getState().settings?.channelProfiles ?? [];
  return readProfiles(raw).find((p) => p.id === id) ?? null;
}

export const useQueueStore = create<QueueState>((set, get) => {
  const commit = (items: QueueItem[]) => {
    save(items);
    set({ items });
  };

  return {
    items: load(),
    running: false,

    add: (channelId, fallbackName, parsed) => commit(addScripts(get().items, channelId, fallbackName, parsed, newId)),
    addTopics: (channelId, topics) => commit(addTopics(get().items, channelId, topics, newId)),
    remove: (id) => commit(removeItem(get().items, id)),
    clearDone: () => commit(clearDone(get().items)),
    retryFailed: () => commit(retryFailed(get().items)),

    run: async (ensureConsent) => {
      if (get().running || usePipelineStore.getState().running) return;
      stopRequested = false;
      set({ running: true });
      try {
        for (;;) {
          const item = nextWaiting(get().items);
          if (!item || stopRequested) break;
          const channel = profileOf(item.channelId);
          if (!channel) {
            commit(setItem(get().items, item.id, { status: "failed", note: "The channel of this video no longer exists." }));
            continue;
          }
          // A queue runs without anyone to press "Continue", so no step waits for the person.
          const profile: ChannelProfile = { ...channel, pauses: { ...NO_PAUSES } };
          commit(setItem(get().items, item.id, { status: "running", note: "" }));
          const pipeline = usePipelineStore.getState();
          if (item.projectId) await pipeline.continueProject(item.projectId, profile, ensureConsent);
          else await pipeline.start({ profile, name: item.name, script: item.script, topic: item.topic, voiceFile: item.voiceFile, ensureConsent });

          const after = usePipelineStore.getState();
          const projectId = after.projectId ?? item.projectId;
          if (after.finished !== null) {
            commit(setItem(get().items, item.id, { status: "done", projectId, note: "" }));
          } else if (!projectId && (after.error?.details === "RateLimit" || after.error?.details === "Auth")) {
            // The script writer cannot work now (usage limit or signed out): the same video waits and the queue stops.
            commit(setItem(get().items, item.id, { status: "waiting", note: after.error.message }));
            break;
          } else if (after.error !== null || after.problems.length > 0) {
            const note = after.error?.message ?? after.problems.join(" ");
            commit(setItem(get().items, item.id, { status: "failed", projectId, note }));
          } else {
            // Cancelled: this video waits again and the queue stops.
            commit(setItem(get().items, item.id, { status: "waiting", projectId }));
            break;
          }
        }
      } finally {
        set({ running: false });
      }
    },

    stop: () => {
      stopRequested = true;
      if (usePipelineStore.getState().running) usePipelineStore.getState().cancel();
    },
  };
});
