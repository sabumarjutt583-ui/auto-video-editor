import { FileAudio, PenLine, Play, X } from "lucide-react";

import { pickFile } from "../../lib/dialog";
import { AUDIO_EXTENSIONS, fileName } from "../../lib/audioFiles";
import { Button, Card, Field, TextInput } from "../ui";

interface Props {
  name: string;
  script: string;
  voiceFile: string | null;
  disabled: boolean;
  problems: string[];
  onName: (value: string) => void;
  onScript: (value: string) => void;
  onVoiceFile: (value: string | null) => void;
  onStart: () => void;
  /** The script writer: shown when the channel has one. */
  writer?: { topic: string; writing: boolean; onTopic: (value: string) => void; onWrite: () => void };
  /** Step 0 word count asked for from Claude, or null when none was asked. */
  wordCount?: number | null;
  onWordCount?: (value: number | null) => void;
}

/** The only things that change from video to video: its name and its script (or your own voice file). */
export function StartCard({ name, script, voiceFile, disabled, problems, onName, onScript, onVoiceFile, onStart, writer, wordCount, onWordCount }: Props) {
  async function chooseVoice() {
    const path = await pickFile("Choose your voice-over", "Audio", AUDIO_EXTENSIONS);
    if (path) onVoiceFile(path);
  }
  return (
    <Card title="New video" description="Give the script and press the button. The app does the rest with the channel profile.">
      <Field label="Video name" htmlFor="mv-name" hint="Empty = the channel name.">
        <TextInput id="mv-name" value={name} maxLength={80} disabled={disabled} onChange={(e) => onName(e.target.value)} />
      </Field>
      {writer && onWordCount && (
        <Field label="Word count (optional)" htmlFor="mv-words" hint="How long the script from Claude should be, in words (50 to 20000). Empty = let the master prompt decide. This is an instruction to Claude, not an exact cut.">
          <TextInput
            id="mv-words"
            inputMode="numeric"
            value={wordCount === null || wordCount === undefined ? "" : String(wordCount)}
            disabled={disabled || writer.writing}
            onChange={(e) => {
              const text = e.target.value.trim();
              if (text === "") {
                onWordCount(null);
                return;
              }
              const parsed = Number(text);
              onWordCount(Number.isFinite(parsed) ? Math.round(parsed) : null);
            }}
          />
        </Field>
      )}
      {writer && (
        <Field label="Topic" htmlFor="mv-topic" hint="What the video is about. Press 'Write the script' to read the script before the video is made, or leave the script empty and press Make video: the script is then written first.">
          <div className="flex flex-wrap gap-2">
            <TextInput id="mv-topic" value={writer.topic} maxLength={2000} disabled={disabled || writer.writing} onChange={(e) => writer.onTopic(e.target.value)} />
            <Button icon={PenLine} loading={writer.writing} disabled={disabled || writer.writing || writer.topic.trim() === ""} onClick={writer.onWrite}>
              Write the script
            </Button>
          </div>
        </Field>
      )}
      <Field label="Script" htmlFor="mv-script" hint={voiceFile ? "Optional with your own voice file: it makes the captions use your exact words." : "The exact words to be spoken. The app makes the voice from this."}>
        <textarea
          id="mv-script"
          value={script}
          disabled={disabled}
          rows={10}
          onChange={(e) => onScript(e.target.value)}
          placeholder="Paste the narration here"
          className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent disabled:opacity-50"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={FileAudio} disabled={disabled} onClick={() => void chooseVoice()}>
          {voiceFile ? "Change voice file" : "Use my own voice file"}
        </Button>
        {voiceFile && (
          <span className="flex items-center gap-2 text-sm text-muted">
            {fileName(voiceFile)}
            <button type="button" aria-label="Remove the voice file" className="cursor-pointer hover:text-fg" disabled={disabled} onClick={() => onVoiceFile(null)}>
              <X size={14} aria-hidden />
            </button>
          </span>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-danger" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="primary" icon={Play} disabled={disabled} onClick={onStart}>
          Make video
        </Button>
      </div>
    </Card>
  );
}
