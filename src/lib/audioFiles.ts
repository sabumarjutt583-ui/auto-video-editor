export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"] as const;

/** The lower-case extension of a file path, or "" when there is none. */
export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isAcceptedAudio(path: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(fileExtension(path));
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
