export interface Language {
  /** ISO 639-1 code that Whisper understands. Empty means "detect it". */
  code: string;
  name: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: "", name: "Detect automatically" },
  { code: "en", name: "English" },
  { code: "ko", name: "Korean" },
  { code: "ja", name: "Japanese" },
  { code: "ru", name: "Russian" },
  { code: "ne", name: "Nepali" },
  { code: "ur", name: "Urdu" },
  { code: "hi", name: "Hindi" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Chinese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "tr", name: "Turkish" },
  { code: "id", name: "Indonesian" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "bn", name: "Bengali" },
];
