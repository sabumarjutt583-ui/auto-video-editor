export type Provider = "groq" | "gemini" | "openai";

/** Whether a key is saved. The key itself never reaches the frontend. */
export type KeyStatus = "set" | "not_set";
