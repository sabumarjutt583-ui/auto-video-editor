import { LifeBuoy } from "lucide-react";
import { useId } from "react";

import type { AppSettings } from "../../types";
import { Card, Checkbox, Field, TextInput } from "../ui";

interface FallbackCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function FallbackCard({ settings, onChange }: FallbackCardProps) {
  const modelId = useId();

  return (
    <Card title="Fallback" description="What to do when every key of the chosen writer is used up or refused." icon={LifeBuoy}>
      <Checkbox
        label="If the chosen writer fails, ask the other one (Gemini or Groq)"
        checked={settings.fallbackToGroq}
        onChange={(event) => onChange({ fallbackToGroq: event.target.checked })}
      />
      <Field label="Groq text model" htmlFor={modelId} hint="Used when Groq writes the texts, or as the backup when the box above is ticked. Needs a saved Groq key.">
        <TextInput
          id={modelId}
          value={settings.groqTextModel}
          onChange={(event) => onChange({ groqTextModel: event.target.value })}
          disabled={!settings.fallbackToGroq && settings.textProvider !== "groq"}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </Card>
  );
}
