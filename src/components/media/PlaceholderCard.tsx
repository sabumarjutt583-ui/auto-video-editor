import { ImageOff } from "lucide-react";

import type { Placeholder } from "../../types";
import { Card, Field, SegmentedControl } from "../ui";

interface PlaceholderCardProps {
  value: Placeholder;
  onChange: (value: Placeholder) => void;
}

/** What the video shows for a scene that has no picture or clip. */
export function PlaceholderCard({ value, onChange }: PlaceholderCardProps) {
  return (
    <Card title="Scenes without media" description="If a scene has no picture or clip when you render, the video shows this instead." icon={ImageOff}>
      <Field label="Missing media">
        <SegmentedControl<Placeholder>
          label="Missing media"
          value={value}
          onChange={onChange}
          options={[
            { value: "hold", label: "Hold previous" },
            { value: "black", label: "Black frame" },
            { value: "blur", label: "Blurred previous" },
          ]}
        />
      </Field>
    </Card>
  );
}
