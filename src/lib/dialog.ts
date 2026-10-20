import { open, save } from "@tauri-apps/plugin-dialog";

/**
 * Opens the system folder picker, starting in `startIn` when given.
 * Resolves to the chosen folder, or null if the person cancelled.
 */
export async function pickFolder(title: string, startIn?: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
    defaultPath: startIn ? startIn : undefined,
  });
  return typeof selected === "string" ? selected : null;
}

/** Opens the system file picker. Resolves to the chosen file, or null if the person cancelled. */
export async function pickFile(
  title: string,
  filterName: string,
  extensions: readonly string[],
  startIn?: string,
): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: filterName, extensions: [...extensions] }],
    defaultPath: startIn ? startIn : undefined,
  });
  return typeof selected === "string" ? selected : null;
}

/** Opens the system "save as" dialog. Resolves to the chosen path, or null if cancelled. */
export async function pickSavePath(
  title: string,
  defaultName: string,
  filterName: string,
  extensions: readonly string[],
): Promise<string | null> {
  const selected = await save({
    title,
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: [...extensions] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Opens the system picker for several pictures and clips. Resolves to the chosen files (empty if cancelled). */
export async function pickMediaFiles(title: string): Promise<string[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title,
    filters: [{ name: "Pictures and clips", extensions: ["png", "jpg", "jpeg", "webp", "mp4", "mov", "webm"] }],
  });
  return Array.isArray(selected) ? selected.filter((p): p is string => typeof p === "string") : [];
}

/** Opens the system picker for several pictures (PNG, JPG, WebP). Resolves to the chosen files (empty if cancelled). */
export async function pickPictureFiles(title: string): Promise<string[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title,
    filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return Array.isArray(selected) ? selected.filter((p): p is string => typeof p === "string") : [];
}

/** Opens the system picker for music files. Resolves to the chosen files (empty if cancelled). */
export async function pickMusicFiles(title: string): Promise<string[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title,
    filters: [{ name: "Music", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }],
  });
  return Array.isArray(selected) ? selected.filter((p): p is string => typeof p === "string") : [];
}
