import { useEffect, useMemo, useRef } from "react";

import { overrideOf } from "../../../lib/editor/model";
import { effectiveTransition, transitionLength } from "../../../lib/editor/transitions";
import { sceneIndexAt } from "../../../lib/editor/timeline";
import { projectFileUrl } from "../../../lib/media/urls";
import { usePlaybackStore } from "../../../store/playbackStore";
import type { EditorData, Project } from "../../../types";
import { drawFrame, type Layer } from "./drawScene";
import { frameSize } from "./frameSize";
import { MediaCache } from "./mediaCache";

export type Overlay = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => void;

/** Builds what the canvas needs for each scene (address of its media, its overrides, its number). */
function buildLayers(project: Project, editor: EditorData, dir: string | null, cache: MediaCache): Layer[] {
  return project.scenes.map((scene) => {
    const path = project.mediaMap[scene.id];
    const file = path === undefined ? undefined : editor.media.find((m) => m.path === path && m.sceneId === scene.id);
    return {
      element: file && dir ? cache.get(projectFileUrl(dir, file.path), file.kind) : null,
      kind: file?.kind ?? "image",
      override: editor.render.kenBurns ? overrideOf(editor, scene.id) : { ...overrideOf(editor, scene.id), kenBurns: "none" },
      number: scene.index,
      start: scene.start,
      duration: scene.duration,
    };
  });
}

/** Keeps a video element at the right moment of its scene, playing or paused. */
function syncVideo(layer: Layer, time: number, playing: boolean): void {
  const video = layer.element;
  if (!(video instanceof HTMLVideoElement) || video.readyState < 1) return;
  const speed = layer.override.speed;
  const wanted = Math.max(0, (time - layer.start) * speed);
  const end = Math.max(0, video.duration - 0.05);
  if (wanted >= end) {
    // A clip shorter than its scene holds its last picture.
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - end) > 0.05) video.currentTime = end;
    return;
  }
  video.playbackRate = speed;
  if (playing) {
    if (Math.abs(video.currentTime - wanted) > 0.3) video.currentTime = wanted;
    if (video.paused) void video.play().catch(() => undefined);
  } else {
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - wanted) > 0.04) video.currentTime = wanted;
  }
}

/** Draws the preview into a canvas: the scene, its Ken Burns move and the transition, in step with `usePlaybackStore`. */
export function useCanvasPreview(canvas: React.RefObject<HTMLCanvasElement | null>, project: Project, editor: EditorData, dir: string | null, overlay: Overlay | null): void {
  const cache = useRef(new MediaCache());
  const dirty = useRef(true);
  const layers = useMemo(() => buildLayers(project, editor, dir, cache.current), [project, editor, dir]);
  const live = useRef({ layers, project, editor, overlay });
  live.current = { layers, project, editor, overlay };
  const size = frameSize(project.settings.aspectRatio);

  // Draw again whenever something changes.
  useEffect(() => {
    dirty.current = true;
  }, [layers, overlay, size.width, size.height]);

  useEffect(() => {
    const store = usePlaybackStore;
    const unsubscribe = store.subscribe(() => {
      dirty.current = true;
    });
    const slow = window.setInterval(() => {
      dirty.current = true; // catches pictures that finished loading
    }, 300);
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const element = canvas.current;
      const context = element?.getContext("2d");
      const { time, playing } = store.getState();
      if (!element || !context || !(playing || dirty.current)) return;
      dirty.current = false;
      const { layers: all, project: current, editor: data } = live.current;
      const index = sceneIndexAt(current.scenes, time);
      const layer = all[index];
      if (!layer) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, element.width, element.height);
        return;
      }
      // Next scene's media starts loading early; the other clips rest.
      all.forEach((other, i) => {
        if (other.element instanceof HTMLVideoElement && i !== index && !other.element.paused) other.element.pause();
      });
      syncVideo(layer, time, playing);
      const previous = index > 0 ? (all[index - 1] ?? null) : null;
      let lastWithMedia: Layer | null = null;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (all[i]?.element) {
          lastWithMedia = all[i] ?? null;
          break;
        }
      }
      const kind = effectiveTransition(layer.override.transition, layer.number, data.render.transitions);
      drawFrame(context, element.width, element.height, {
        current: layer,
        previous,
        lastWithMedia,
        transition: kind,
        transitionSeconds: previous ? transitionLength(kind, layer.duration, previous.duration) : 0,
        placeholder: data.placeholder,
        time,
      });
      live.current.overlay?.(context, element.width, element.height, time);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(slow);
      unsubscribe();
    };
  }, [canvas]);

  // Free the loaded clips when the preview closes.
  useEffect(() => {
    const items = cache.current;
    return () => items.clear();
  }, []);
}
