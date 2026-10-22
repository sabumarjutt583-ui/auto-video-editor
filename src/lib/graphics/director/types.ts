/** What kind of moment in the narration could use a graphic. */
export type TriggerKind = "number" | "money" | "percent" | "date" | "place" | "person" | "list" | "quote" | "comparison";

export const TRIGGER_KINDS: readonly TriggerKind[] = ["number", "money", "percent", "date", "place", "person", "list", "quote", "comparison"];

/** A candidate for a graphic, found by plain rules (no AI). */
export interface Trigger {
  kind: TriggerKind;
  /** The words that were found, as written. */
  text: string;
  /** When the first word of it is spoken (seconds from the start of the voice-over). */
  time: number;
  /** When the last word of it ends. */
  endTime: number;
  /** Index into the scene's words (-1 when the scene has no timed words and the time was estimated). */
  wordIndex: number;
  /** A number: its value (`2 million` is 2000000); a money amount or percent too. */
  value?: number;
  /** Money: the currency symbol or code (`$`, `EUR`). */
  currency?: string;
  /** Place: the ISO alpha-2 code of the country (or of the country of the city). */
  code?: string;
  /** Place: the city name in English when it is a city. */
  city?: string;
  /** Place: where the city is, for pins. */
  lat?: number;
  lon?: number;
  /** True when the time comes from the timed words (exact), false when it was estimated from the script text. */
  exact: boolean;
}

/** One timed word (same shape as the project's words). */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** The part of a project the detection needs for one scene. */
export interface SceneInput {
  id: string;
  start: number;
  end: number;
  /** The script text of the scene. */
  text: string;
  /** Only the words of this scene. */
  words: readonly TimedWord[];
}
