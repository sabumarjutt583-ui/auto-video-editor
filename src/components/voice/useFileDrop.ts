import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

/** Listens for files dropped on the window. `dragging` is true while a file is held over it. */
export function useFileDrop(onDrop: (paths: string[]) => void, enabled: boolean): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    if (!enabled) {
      setDragging(false);
      return;
    }
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else {
          setDragging(false);
          handler.current(payload.paths);
        }
      })
      .then((stop) => {
        if (stopped) stop();
        else unlisten = stop;
      });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [enabled]);

  return { dragging };
}
