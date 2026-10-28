import { Cpu } from "lucide-react";
import { useId } from "react";

import { GEMINI_MODEL_OPTIONS, WHISPER_MODEL_OPTIONS } from "../../lib/models";
import type { AppSettings } from "../../types";
import { Card, Field, Select } from "../ui";
import { ModelPicker } from "./ModelPicker";

interface ModelsCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function ModelsCard({ settings, onChange }: ModelsCardProps) {
  const geminiId = useId();
  const whisperId = useId();

  // Keep a model that was typed by hand (or set by a newer version) selectable.
  const whisperOptions = WHISPER_MODEL_OPTIONS.some((option) => option.value === settings.groqWhisperModel)
    ? WHISPER_MODEL_OPTIONS
    : [...WHISPER_MODEL_OPTIONS, { value: settings.groqWhisperModel, label: settings.groqWhisperModel }];

  return (
    <Card title="Models" description="Which AI models the app should use." icon={Cpu}>
      <Field
        label="Gemini model"
        htmlFor={geminiId}
        hint="Used for scenes, characters and prompts. If Google releases a newer model, choose Other and type its name."
      >
        <ModelPicker
          id={geminiId}
          value={settings.geminiModel}
          options={GEMINI_MODEL_OPTIONS}
          onChange={(geminiModel) => onChange({ geminiModel })}
        />
      </Field>

      <Field label="Groq Whisper model" htmlFor={whisperId} hint="Used to find the exact time of every spoken word.">
        <Select
          id={whisperId}
          value={settings.groqWhisperModel}
          onChange={(event) => onChange({ groqWhisperModel: event.target.value })}
        >
          {whisperOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    </Card>
  );
}
