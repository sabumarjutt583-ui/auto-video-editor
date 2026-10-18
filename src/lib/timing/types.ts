/** One spoken word with its time in seconds. Same shape as the project's Word. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** A subtitle line with its time. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** What a timing-file parser gives back. */
export interface ParsedTiming {
  words: TimedWord[];
  /** True when word times were estimated from line times (SRT, VTT, or JSON without words). */
  estimated: boolean;
  /** Which format was recognised, e.g. "SRT" or "Whisper JSON". */
  format: string;
}

/** A problem a person can understand, e.g. "This SRT file has no subtitle lines". */
export class TimingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimingParseError";
  }
}
