import type { AspectRatio, Quality } from "../../types/settings.ts";

/** The pixel size of the finished video for an aspect ratio and quality (shown in the top bar). */
export function outputSize(aspect: AspectRatio, quality: Quality): { width: number; height: number } {
  const short = quality === "720p" ? 720 : quality === "1080p" ? 1080 : 2160;
  if (aspect === "1:1") return { width: short, height: short };
  const long = Math.round((short * 16) / 9);
  return aspect === "9:16" ? { width: short, height: long } : { width: long, height: short };
}
