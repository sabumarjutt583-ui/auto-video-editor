import type { StyleProfile } from "./style.ts";

/** What studies the reference pictures: Gemini with an API key, or a web chat (Gemini's Google accounts, or ChatGPT's ChatGPT accounts). */
export type AnalyzeEngine = "gemini" | "chat" | "chatgpt";

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
  /** "gemini", "chatgpt" or "chat" ("" when unknown; "openai" only on old saved styles). */
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
