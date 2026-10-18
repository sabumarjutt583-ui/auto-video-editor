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
    <Card title="Fallback" description="What to do when Gemini cannot answer." icon={LifeBuoy}>
      <Checkbox
        label="If Gemini fails, use Groq text model"
        checked={settings.fallbackToGroq}
        onChange={(event) => onChange({ fallbackToGroq: event.target.checked })}
      />
      <Field label="Groq text model" htmlFor={modelId} hint="Only used when the box above is ticked. Needs a saved Groq key.">
        <TextInput
          id={modelId}
          value={settings.groqTextModel}
          onChange={(event) => onChange({ groqTextModel: event.target.value })}
          disabled={!settings.fallbackToGroq}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </Card>
  );
}
