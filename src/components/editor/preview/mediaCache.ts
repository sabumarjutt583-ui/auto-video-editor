import type { MediaKind } from "../../../types";

export type Element = HTMLImageElement | HTMLVideoElement;

/** Loaded pictures and clips for the preview, by address. */
export class MediaCache {
  private items = new Map<string, Element>();

  get(url: string, kind: MediaKind): Element {
    const existing = this.items.get(url);
    if (existing) return existing;
    let created: Element;
    if (kind === "video") {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      created = video;
    } else {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      created = image;
    }
    this.items.set(url, created);
    return created;
  }

  clear(): void {
    for (const element of this.items.values()) {
      if (element instanceof HTMLVideoElement) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    }
    this.items.clear();
  }
}

export function sizeOf(element: Element): { width: number; height: number } {
  return element instanceof HTMLVideoElement ? { width: element.videoWidth, height: element.videoHeight } : { width: element.naturalWidth, height: element.naturalHeight };
}

export function isReady(element: Element): boolean {
  const { width, height } = sizeOf(element);
  return width > 0 && height > 0 && (element instanceof HTMLVideoElement ? element.readyState >= 2 : element.complete);
}
