import { CloudDownload } from "lucide-react";

import type { AppSettings } from "../../types";
import { Card, Field, TextInput } from "../ui";

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Where the sound and style packages are published. */
export function LibraryUrlCard({ settings, onChange }: Props) {
  return (
    <Card title="Library updates" description="The app can download new sounds and styles from a web folder that holds manifest.json. No keys are used for this." icon={CloudDownload}>
      <Field label="Update address" htmlFor="library-url" hint="Starts with https://, for example the “latest release” folder of a GitHub project. Leave empty to turn updates off.">
        <TextInput id="library-url" value={settings.libraryUpdateUrl} placeholder="https://github.com/your-name/your-project/releases/latest/download" onChange={(e) => onChange({ libraryUpdateUrl: e.target.value })} spellCheck={false} />
      </Field>
    </Card>
  );
}
