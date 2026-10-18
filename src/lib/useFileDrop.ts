import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

/**
 * Calls `onDrop` with the paths of files or folders dropped on the window. `over` is true while
 * something is being dragged above the window, so a drop zone can light up.
 */
export function useFileDrop(onDrop: (paths: string[]) => void, enabled: boolean): { over: boolean } {
  const [over, setOver] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") setOver(true);
        else if (payload.type === "leave") setOver(false);
        else if (payload.type === "drop") {
          setOver(false);
          if (payload.paths.length > 0) handler.current(payload.paths);
        }
      })
      .then((stop) => {
        if (stopped) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      unlisten?.();
      setOver(false);
    };
  }, [enabled]);

  return { over };
}
