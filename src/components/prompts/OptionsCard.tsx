import { SlidersHorizontal } from "lucide-react";

import { TARGET_TOOLS } from "../../lib/prompts/options";
import type { AspectRatio, DetailLevel, OutputType, Project, PromptSettings, StyleProfile, TargetTool } from "../../types";
import { Card, Field, Select, SegmentedControl } from "../ui";

interface OptionsCardProps {
  project: Project;
  style: StyleProfile | null;
  onSettings: (settings: PromptSettings) => void;
  onAspect: (aspect: AspectRatio) => void;
}

/** Output type, detail, aspect ratio and the tool the prompts are written for. */
export function OptionsCard({ project, style, onSettings, onAspect }: OptionsCardProps) {
  const settings = project.promptSettings;
  return (
    <Card title="Prompt options" description="The style and the character texts are added by the app, so every prompt keeps the same look." icon={SlidersHorizontal}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Output type">
          <SegmentedControl<OutputType>
            label="Output type"
            value={settings.outputType}
            onChange={(outputType) => onSettings({ ...settings, outputType })}
            options={[
              { value: "image", label: "Image" },
              { value: "video", label: "Video" },
              { value: "image_motion", label: "Image + Motion" },
            ]}
          />
        </Field>
        <Field label="Detail level">
          <SegmentedControl<DetailLevel>
            label="Detail level"
            value={settings.detail}
            onChange={(detail) => onSettings({ ...settings, detail })}
            options={[
              { value: "short", label: "Short (~40 words)" },
              { value: "medium", label: "Medium (~70)" },
              { value: "detailed", label: "Very detailed (~120)" },
            ]}
          />
        </Field>
        <Field label="Aspect ratio">
          <SegmentedControl<AspectRatio>
            label="Aspect ratio"
            value={project.settings.aspectRatio}
            onChange={onAspect}
            options={[
              { value: "16:9", label: "16:9" },
              { value: "9:16", label: "9:16" },
              { value: "1:1", label: "1:1" },
            ]}
          />
        </Field>
        <Field label="Prompts are for" htmlFor="target-tool" hint={TARGET_TOOLS.find((t) => t.value === settings.tool)?.hint}>
          <Select id="target-tool" value={settings.tool} onChange={(event) => onSettings({ ...settings, tool: event.target.value as TargetTool })}>
            {TARGET_TOOLS.map((tool) => (
              <option key={tool.value} value={tool.value}>
                {tool.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-sm text-muted">
        Style: <span className="font-medium text-fg">{style ? style.name : "none chosen yet"}</span>. Change it in the Style &amp; cast step.
      </p>
    </Card>
  );
}
