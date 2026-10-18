import { FolderOpen, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

import { pickFolder } from "../../lib/dialog";
import { toAppError } from "../../lib/errors";
import type { AppError, AppSettings, AspectRatio, Quality } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Field, SegmentedControl, TextInput } from "../ui";

const ASPECT_RATIOS: readonly { value: AspectRatio; label: string }[] = [
  { value: "16:9", label: "16:9 Landscape" },
  { value: "9:16", label: "9:16 Vertical" },
  { value: "1:1", label: "1:1 Square" },
];

const QUALITIES: readonly { value: Quality; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4K", label: "4K" },
];

interface DefaultsCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

export function DefaultsCard({ settings, onChange }: DefaultsCardProps) {
  const folderId = useId();
  const [pickerError, setPickerError] = useState<AppError | null>(null);

  async function chooseFolder() {
    setPickerError(null);
    try {
      const folder = await pickFolder("Choose the export folder", settings.exportFolder);
      if (folder) onChange({ exportFolder: folder });
    } catch (error) {
      setPickerError(toAppError(error, "The folder picker could not be opened."));
    }
  }

  return (
    <Card title="Defaults" description="Used for every new project. You can change them per project later." icon={SlidersHorizontal}>
      <Field label="Export folder" htmlFor={folderId} hint="Where finished videos are saved.">
        <div className="flex gap-2">
          <TextInput
            id={folderId}
            readOnly
            value={settings.exportFolder}
            title={settings.exportFolder}
            placeholder="No folder chosen yet"
          />
          <Button icon={FolderOpen} onClick={() => void chooseFolder()} className="shrink-0">
            Choose folder…
          </Button>
          {settings.exportFolder && (
            <Button onClick={() => onChange({ exportFolder: "" })} className="shrink-0">
              Clear
            </Button>
          )}
        </div>
        {pickerError && <ErrorNotice error={pickerError} />}
      </Field>

      <Field label="Default aspect ratio">
        <SegmentedControl
          label="Default aspect ratio"
          options={ASPECT_RATIOS}
          value={settings.defaultAspectRatio}
          onChange={(defaultAspectRatio) => onChange({ defaultAspectRatio })}
        />
      </Field>

      <Field label="Default quality">
        <SegmentedControl
          label="Default quality"
          options={QUALITIES}
          value={settings.defaultQuality}
          onChange={(defaultQuality) => onChange({ defaultQuality })}
        />
      </Field>
    </Card>
  );
}
