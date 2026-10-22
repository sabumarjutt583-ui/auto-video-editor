import type { StyleProfile } from "./style.ts";

/** What studies the reference pictures: Gemini or OpenAI with an API key, or Gemini's web chat. */
export type AnalyzeEngine = "gemini" | "openai" | "chat";

/** A reference picture that was checked and shrunk (a JPEG of at most 1024 px). */
export interface PreparedImage {
  path: string;
  /** The name of the file the person chose. */
  name: string;
}

/** The pictures and notes kept with a custom style. */
export interface StyleRefs {
  images: PreparedImage[];
  description: string;
  /** "gemini", "openai" or "chat" ("" when unknown). */
  engine: string;
}

export interface AnalyzeRequest {
  images: string[];
  name: string;
  description: string;
  engine: AnalyzeEngine;
  /** Set when asking again: the rules the earlier answer broke. */
  problems: string[];
  /** The earlier answer (JSON text). */
  previous: string | null;
}

export interface AnalyzeAnswer {
  /** A draft: id and category are empty, the version is 1.0.0. */
  style: StyleProfile;
  raw: string;
}
