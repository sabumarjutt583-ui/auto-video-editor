import { create } from "zustand";

import { cancelJob } from "../lib/audio";
import type { JobProgress } from "../types";

export interface JobInfo {
  id: string;
  kind: string;
  stage: string;
  /** 0 to 100. */
  percent: number;
}

interface JobState {
  jobs: Record<string, JobInfo>;
  report: (progress: JobProgress) => void;
}

export const useJobStore = create<JobState>((set) => ({
  jobs: {},
  report: (progress) =>
    set((state) => {
      // Updates that arrive after a job finished are ignored.
      if (!(progress.jobId in state.jobs)) return state;
      return {
        jobs: {
          ...state.jobs,
          [progress.jobId]: { id: progress.jobId, kind: progress.kind, stage: progress.stage, percent: progress.percent },
        },
      };
    }),
}));

let counter = 0;

/**
 * Runs a background job. `start` receives the job id to pass to the engine. While it runs,
 * its progress is in the job store; the returned promise settles when it finishes.
 */
export async function runJob<T>(kind: string, stage: string, start: (jobId: string) => Promise<T>): Promise<T> {
  counter += 1;
  const id = `${kind}-${Date.now().toString(36)}-${counter}`;
  useJobStore.setState((state) => ({ jobs: { ...state.jobs, [id]: { id, kind, stage, percent: 0 } } }));
  try {
    return await start(id);
  } finally {
    useJobStore.setState((state) => {
      const { [id]: _finished, ...rest } = state.jobs;
      return { jobs: rest };
    });
  }
}

/** Asks the engine to stop a running job. */
export function requestCancel(jobId: string): void {
  void cancelJob(jobId);
}

/** The running job of one of these kinds, if any. */
export function selectJob(kinds: readonly string[]): (state: JobState) => JobInfo | null {
  return (state) => Object.values(state.jobs).find((job) => kinds.includes(job.kind)) ?? null;
}
