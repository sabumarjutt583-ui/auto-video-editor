import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import eula from "../../../LICENSE-EULA.txt?raw";
import { Card } from "../ui";

/** Settings > About: version and the license agreement. */
export function AboutCard() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion, () => setVersion("unknown"));
  }, []);
  return (
    <Card title="About" description="Auto Video Editor is free to use. You may not copy, change, reverse engineer or resell it." icon={Info}>
      <p className="text-sm">
        Version: <strong>{version || "…"}</strong>
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-fg">License agreement (EULA)</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs" data-testid="eula-text">
          {eula}
        </pre>
      </details>
    </Card>
  );
}
