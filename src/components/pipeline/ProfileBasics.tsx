import { LANGUAGES } from "../../lib/languages";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import type { AspectRatio, Quality } from "../../types";
import type { SceneMode } from "../../types/project";
import { Card, Field, NumberField, SegmentedControl, Select, TextInput } from "../ui";

interface Props {
  profile: ChannelProfile;
  onChange: (profile: ChannelProfile) => void;
}

/** Name, language, video shape and how the narration is cut into scenes. */
export function ProfileBasics({ profile, onChange }: Props) {
  const scenes = profile.scenes;
  return (
    <Card title="Channel" description="The basics of this channel. Every new video starts from these choices.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Channel name" htmlFor="p-name">
          <TextInput id="p-name" value={profile.name} maxLength={60} onChange={(e) => onChange({ ...profile, name: e.target.value })} />
        </Field>
        <Field label="Narration language" htmlFor="p-lang" hint="Used to find the time of every word. Pick the language you speak in the video.">
          <Select id="p-lang" value={profile.language} onChange={(e) => onChange({ ...profile, language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Video shape">
          <SegmentedControl<AspectRatio>
            label="Video shape"
            value={profile.aspect}
            onChange={(aspect) => onChange({ ...profile, aspect })}
            options={[
              { value: "16:9", label: "Wide 16:9" },
              { value: "9:16", label: "Shorts 9:16" },
              { value: "1:1", label: "Square" },
            ]}
          />
        </Field>
        <Field label="Quality" htmlFor="p-quality">
          <Select id="p-quality" value={profile.quality} onChange={(e) => onChange({ ...profile, quality: e.target.value as Quality })}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </Select>
        </Field>
      </div>
      <Field label="Scenes" hint="How the narration is cut. A scene is one picture on screen.">
        <SegmentedControl<SceneMode>
          label="How scenes are cut"
          value={scenes.mode}
          onChange={(mode) => onChange({ ...profile, scenes: { ...scenes, mode } })}
          options={[
            { value: "seconds", label: "Every N seconds" },
            { value: "sentence", label: "Per sentence" },
            { value: "ai", label: "Gemini decides" },
          ]}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        {scenes.mode === "seconds" && (
          <Field label="Seconds per scene" htmlFor="p-seconds" hint="1 to 60. Cuts happen at the end of a word.">
            <NumberField id="p-seconds" value={scenes.targetSeconds} min={1} max={60} step={0.5} onChange={(targetSeconds) => onChange({ ...profile, scenes: { ...scenes, targetSeconds } })} />
          </Field>
        )}
        {scenes.mode === "sentence" && (
          <Field label="Sentences per scene" htmlFor="p-sentences">
            <NumberField id="p-sentences" value={scenes.sentencesPerScene} min={1} max={4} onChange={(sentencesPerScene) => onChange({ ...profile, scenes: { ...scenes, sentencesPerScene } })} />
          </Field>
        )}
        <Field label="Shortest scene (seconds)" htmlFor="p-min" hint="Shorter scenes join the one before. 0 = off.">
          <NumberField id="p-min" value={scenes.minSeconds ?? 2} min={0} max={10} step={0.5} onChange={(minSeconds) => onChange({ ...profile, scenes: { ...scenes, minSeconds } })} />
        </Field>
      </div>
    </Card>
  );
}
