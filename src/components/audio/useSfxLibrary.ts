import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { listSfx, type SfxListing } from "../../lib/audio/api";
import { toAppError } from "../../lib/errors";
import type { AppError } from "../../types";

let cache: SfxListing | null = null;
const listeners = new Set<() => void>();

/** Forgets the loaded sounds (after the library was updated), so every list loads them again. */
export function resetSfxCache(): void {
  cache = null;
  listeners.forEach((listener) => listener());
}

export interface SfxLibraryView {
  sounds: SfxListing["sounds"];
  warnings: string[];
  loading: boolean;
  error: AppError | null;
  /** Address the webview can play for a sound. */
  urlOf: (file: string) => string;
}

/** The built-in sound effects (read once per session). */
export function useSfxLibrary(): SfxLibraryView {
  const [listing, setListing] = useState<SfxListing | null>(cache);
  const [error, setError] = useState<AppError | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setListing(null);
      setVersion((v) => v + 1);
    };
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, []);
  useEffect(() => {
    if (cache) {
      setListing(cache);
      return undefined;
    }
    let stale = false;
    listSfx()
      .then((result) => {
        cache = result;
        if (!stale) setListing(result);
      })
      .catch((e: unknown) => {
        if (!stale) setError(toAppError(e));
      });
    return () => {
      stale = true;
    };
  }, [version]);
  const dir = listing?.dir ?? "";
  return {
    sounds: listing?.sounds ?? [],
    warnings: listing?.warnings ?? [],
    loading: listing === null && error === null,
    error,
    urlOf: (file) => convertFileSrc(`${dir.replace(/[\\/]+$/, "")}/${file}`),
  };
}

let current: HTMLAudioElement | null = null;

/** Plays a short preview; a new preview stops the one before it. */
export function previewSound(url: string, gain = 1): void {
  try {
    current?.pause();
    const element = new Audio(url);
    element.volume = Math.min(1, Math.max(0, gain));
    current = element;
    void element.play().catch(() => undefined);
  } catch {
    // No sound device: nothing to do.
  }
}
