import { FileText } from "lucide-react";

import { pickFile } from "../../lib/dialog";
import { LANGUAGES } from "../../lib/languages";
import { readTextFile } from "../../lib/timing/api";
import { Button, Card, Field, Select } from "../ui";

interface ScriptCardProps {
  script: string;
  language: string;
  /** The words are already timed: the script and language can no longer be changed. */
  locked: boolean;
  onScript: (script: string) => void;
  onLanguage: (language: string) => void;
  onError: (message: string, details: string) => void;
}

/** The narration text and its language. The script's exact wording is used for the scenes. */
export function ScriptCard({ script, language, locked, onScript, onLanguage, onError }: ScriptCardProps) {
  async function loadFile() {
    try {
      const path = await pickFile("Choose your script", "Text", ["txt", "md"]);
      if (!path) return;
      onScript(await readTextFile(path));
    } catch (caught) {
      const details = caught instanceof Error ? caught.message : JSON.stringify(caught);
      onError("The script file could not be read.", details);
    }
  }

  return (
    <Card
      title="Script and language"
      description="Paste the text of your narration. Its exact words are used for the scenes, the voice only gives the times. You can leave it empty and use what the voice says."
      icon={FileText}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
        <Field label="Language of the narration" htmlFor="language" hint="Helps the voice recognition. Automatic works for most voices.">
          <Select id="language" value={language} disabled={locked} onChange={(event) => onLanguage(event.target.value)}>
            {LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Script" htmlFor="script" hint={`${script.length.toLocaleString()} characters`}>
        <textarea
          id="script"
          value={script}
          disabled={locked}
          onChange={(event) => onScript(event.target.value)}
          rows={8}
          dir="auto"
          placeholder="Paste your script here…"
          className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted/70 transition-colors hover:border-accent/40 focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        />
      </Field>
      {!locked && (
        <div>
          <Button icon={FileText} onClick={() => void loadFile()}>
            Load from a text file
          </Button>
        </div>
      )}
    </Card>
  );
}
