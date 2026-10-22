import { useMemo, useState } from "react";

import { SAMPLE_GRAPHICS } from "../../lib/graphics/samples";
import { describeIssues, repairSpec } from "../../lib/graphics/spec";
import { Button } from "../ui";
import { GraphicPreview } from "./GraphicPreview";

interface GraphicLabProps {
  aspect: "16:9" | "9:16" | "1:1";
  backgroundUrl?: string | null;
}

/** Try the new graphics engine: pick a sample or paste a GraphicSpec (JSON) and watch it play. */
export function GraphicLab({ aspect, backgroundUrl }: GraphicLabProps) {
  const first = SAMPLE_GRAPHICS[0];
  const [text, setText] = useState(() => JSON.stringify(first?.spec ?? {}, null, 2));
  const result = useMemo(() => {
    try {
      return repairSpec(JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  }, [text]);
  const spec = result?.ok ? result.spec : null;
  return (
    <details className="rounded-xl border border-line bg-surface-2 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Graphic preview (new engine)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs text-muted">Graphics are drawn by the app itself, frame by frame, so the preview is exactly what the video gets. Pick an example or paste a graphic description.</p>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_GRAPHICS.map((s) => (
            <Button key={s.id} onClick={() => setText(JSON.stringify(s.spec, null, 2))}>{s.label}</Button>
          ))}
        </div>
        {spec ? <GraphicPreview spec={spec} aspect={aspect} backgroundUrl={backgroundUrl ?? null} /> : <p className="text-xs text-danger" role="alert">{result === null ? "This is not valid JSON." : `This graphic cannot be used:\n${describeIssues(result.issues)}`}</p>}
        {result?.ok && result.issues.length > 0 && <p className="whitespace-pre-line text-xs text-muted" role="status">Fixed automatically:{"\n"}{describeIssues(result.issues)}</p>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Graphic description (JSON)"
          className="h-48 w-full resize-y rounded-lg border border-line bg-surface p-2 font-mono text-xs"
        />
      </div>
    </details>
  );
}
