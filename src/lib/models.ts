export interface ModelOption {
  value: string;
  label: string;
}

/** Suggested Gemini models. The user can also type any newer model name. */
export const GEMINI_MODEL_OPTIONS: readonly ModelOption[] = [
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash (recommended)" },
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (cheaper)" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
];

/** Suggested OpenAI models that can look at pictures. The user can also type any other model name. */
export const OPENAI_MODEL_OPTIONS: readonly ModelOption[] = [
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini (recommended)" },
  { value: "gpt-4.1", label: "GPT-4.1 (most careful)" },
  { value: "gpt-4o-mini", label: "GPT-4o mini (cheaper)" },
];

export const WHISPER_MODEL_OPTIONS: readonly ModelOption[] = [
  { value: "whisper-large-v3-turbo", label: "whisper-large-v3-turbo (faster, default)" },
  { value: "whisper-large-v3", label: "whisper-large-v3 (most accurate)" },
];
