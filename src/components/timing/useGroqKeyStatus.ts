import { useEffect, useState } from "react";

import { getKeyStatus } from "../../lib/keys";
import type { KeyStatus } from "../../types";

/** Whether a Groq key is saved ("unknown" while checking). Never reads the key itself. */
export function useGroqKeyStatus(): KeyStatus | "unknown" {
  const [status, setStatus] = useState<KeyStatus | "unknown">("unknown");
  useEffect(() => {
    let current = true;
    getKeyStatus("groq")
      .then((value) => {
        if (current) setStatus(value);
      })
      .catch(() => {
        if (current) setStatus("unknown");
      });
    return () => {
      current = false;
    };
  }, []);
  return status;
}
