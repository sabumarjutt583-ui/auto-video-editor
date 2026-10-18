import type { TimeRange } from "./project";

export interface VoiceImport {
  originalPath: string;
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}

export interface Waveform {
  duration: number;
  /** Values from 0 to 1. */
  peaks: number[];
}

export interface CleanupParams {
  thresholdDb: number;
  minSilence: number;
  padding: number;
  normalize: boolean;
}

/** What Preview shows. */
export interface SilenceReport {
  duration: number;
  removed: TimeRange[];
  newDuration: number;
}

/** What Apply and Skip return. */
export interface CleanupResult {
  processedPath: string;
  duration: number;
  removed: TimeRange[];
  sampleRate: number;
  channels: number;
}

export interface JobProgress {
  jobId: string;
  kind: string;
  stage: string;
  percent: number;
}
