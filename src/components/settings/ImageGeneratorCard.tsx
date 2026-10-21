import { ImagePlus } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { ConsentDialog } from "../imagegen/ConsentDialog";
import { imagegenDetectBrowser } from "../../lib/imagegen/api";
import { useImageGenStore } from "../../store/imagegenStore";
import type { BrowserMode } from "../../types/imagegen";
import { ErrorNotice } from "../ErrorNotice";
import { Card, Field, Select } from "../ui";
import { CommitInput } from "./CommitInput";

/** Settings of the Image Generator: model names, Cloudflare account, the browser and the one-time notice. */
export function ImageGeneratorCard() {
  const snapshot = useImageGenStore((state) => state.snapshot);
  const error = useImageGenStore((state) => state.error);
  const save = useImageGenStore((state) => state.saveSettings);
  const geminiId = useId();
  const cfModelId = useId();
  const cfAccountId = useId();
  const browserId = useId();
  const modeId = useId();
  const [found, setFound] = useState<string | null | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const browserPath = snapshot?.settings.browserPath;

  useEffect(() => {
    void useImageGenStore.getState().init();
  }, []);
  useEffect(() => {
    if (browserPath === undefined) return;
    void imagegenDetectBrowser().then(setFound).catch(() => setFound(null));
  }, [browserPath]);

  if (!snapshot) return error ? <ErrorNotice error={error} /> : null;
  const { settings } = snapshot;

  return (
    <Card title="Image Generator" description="Settings for the pictures made on the Image Generator page." icon={ImagePlus}>
      <Field label="Gemini image model" htmlFor={geminiId} hint="Used by the API engine with your Gemini key. You can change the name when Google releases a new model.">
        <CommitInput id={geminiId} value={settings.geminiImageModel} onCommit={(value) => void save({ geminiImageModel: value })} />
      </Field>
      <Field label="Cloudflare account ID" htmlFor={cfAccountId} hint="Find it in your Cloudflare dashboard. The token is saved in the keychain (see the Cloudflare card).">
        <CommitInput id={cfAccountId} value={settings.cloudflareAccountId} onCommit={(value) => void save({ cloudflareAccountId: value.trim() })} />
      </Field>
      <Field label="Cloudflare model" htmlFor={cfModelId}>
        <CommitInput id={cfModelId} value={settings.cloudflareModel} onCommit={(value) => void save({ cloudflareModel: value })} />
      </Field>
      <Field label="Browser path" htmlFor={browserId} hint={found ? `Using: ${found}` : found === null ? "No Chrome, Edge, Brave or Chromium was found. Install one, or type the path of its program here." : "Leave empty to find a browser automatically."}>
        <CommitInput id={browserId} value={settings.browserPath} placeholder="Automatic" onCommit={(value) => void save({ browserPath: value })} />
      </Field>
      <Field label="Background browser" htmlFor={modeId} hint={settings.browserNote || "Hidden is quiet. If Google does not accept the hidden browser, the app switches to a minimized window by itself."}>
        <Select id={modeId} value={settings.browserMode} onChange={(event) => void save({ browserMode: event.target.value === "window" ? ("window" satisfies BrowserMode) : "hidden" })}>
          <option value="hidden">Hidden</option>
          <option value="window">Minimized window</option>
        </Select>
      </Field>
      <p className="text-sm text-muted">
        {settings.consent ? `You accepted the free engine notice on ${settings.consent.acceptedAt}.` : "You have not accepted the free engine notice yet."}{" "}
        <button type="button" onClick={() => setReading(true)} className="cursor-pointer font-medium text-accent-fg hover:underline">
          Read it again
        </button>
      </p>
      {reading && <ConsentDialog readOnly onAccept={() => setReading(false)} onClose={() => setReading(false)} />}
      {error && <ErrorNotice error={error} />}
    </Card>
  );
}
