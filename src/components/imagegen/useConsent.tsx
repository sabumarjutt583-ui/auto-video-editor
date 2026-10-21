import { useCallback, useRef, useState, type ReactNode } from "react";

import { imagegenAcceptConsent, imagegenState } from "../../lib/imagegen/api";
import { useImageGenStore } from "../../store/imagegenStore";
import { ConsentDialog } from "./ConsentDialog";

/** `ensure()` resolves true at once when the notice was accepted before, otherwise after the person decides. */
export function useConsent(): { ensure: () => Promise<boolean>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);

  const ensure = useCallback(async () => {
    const snapshot = useImageGenStore.getState().snapshot ?? (await imagegenState());
    if (!snapshot.consentNeeded) return true;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);

  function finish(accepted: boolean) {
    setOpen(false);
    resolver.current?.(accepted);
    resolver.current = null;
  }

  async function accept() {
    try {
      await imagegenAcceptConsent();
      useImageGenStore.setState({ snapshot: await imagegenState() });
      finish(true);
    } catch (error) {
      useImageGenStore.getState().setError({ message: "Your answer could not be saved.", details: error instanceof Error ? error.message : String(error) });
      finish(false);
    }
  }

  return { ensure, dialog: open ? <ConsentDialog onAccept={() => void accept()} onClose={() => finish(false)} /> : null };
}
