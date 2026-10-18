import { Lock, LockOpen, Plus, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { generateText } from "../../lib/ai";
import { applyCast, newCharacter, newLocation, removeCharacter, removeLocation, sceneCounts } from "../../lib/bible/edit";
import { BIBLE_SYSTEM_INSTRUCTION, CAST_ONLY_INSTRUCTION, castOnlyPrompt, parseDetected, scenesPrompt, type Detected } from "../../lib/bible/detect";
import { isCancelled, toAppError } from "../../lib/errors";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { JobBar } from "../voice/JobBar";
import { CharacterCard, LocationCard } from "./BibleCards";

/** Step 4 (second half): the people and places that must look the same in every picture. */
export function BibleSection({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const job = useJobStore(selectJob(["ai"]));
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const { characterBible: characters, locationBible: locations, scenes, bibleLocked: locked } = project;
  const counts = useMemo(() => sceneCounts(scenes), [scenes]);
  const detected = characters.length > 0 || locations.length > 0;
  const busy = detecting || job !== null;

  /** Asks Gemini twice at most. `castOnly` keeps the locked bible and only fills who is in each scene. */
  async function detect(castOnly: boolean) {
    setError(null);
    setNotice(null);
    setDetecting(true);
    const lines = scenes.map((scene) => ({ id: scene.id, text: scene.text }));
    const ids = scenes.map((scene) => scene.id);
    const prompt = castOnly ? castOnlyPrompt(characters, locations, lines) : scenesPrompt(lines);
    const system = castOnly ? CAST_ONLY_INSTRUCTION : BIBLE_SYSTEM_INSTRUCTION;
    try {
      let result: Detected | null = null;
      for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
        const answer = await runJob("ai", castOnly ? "Finding who is in each scene" : "Finding characters and places", (id) => generateText(prompt, system, true, id));
        result = parseDetected(answer.text, ids, castOnly ? { characters, locations } : undefined);
      }
      if (!result) {
        setError({ message: "Gemini's answer could not be read. Please try again.", details: "The answer was not valid JSON in the expected shape (tried twice)." });
        return;
      }
      if (castOnly) {
        update({ scenes: applyCast(scenes, result.cast) });
        setNotice("The cast of every scene was filled in.");
      } else {
        update({ characterBible: result.characters, locationBible: result.locations, scenes: applyCast(scenes, result.cast) });
        setNotice(result.characters.length === 0 ? "No characters were found. Only locations will be used." : null);
      }
    } catch (caught) {
      if (isCancelled(caught)) setNotice("Cancelled. Nothing was changed.");
      else setError(toAppError(caught, "The characters could not be detected."));
    } finally {
      setDetecting(false);
    }
  }

  const scenesWithoutCast = scenes.length > 0 && scenes.every((scene) => scene.characterIds.length === 0 && scene.locationId === null);

  return (
    <Card title="Characters and locations" description="Every person and place gets one fixed English description. The app puts these exact words into every prompt where they appear, so they always look the same." icon={Users}>
      {error && <ErrorNotice error={error} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Sparkles} loading={detecting} disabled={busy || locked || scenes.length === 0} onClick={() => void detect(false)}>
          Auto detect
        </Button>
        <Button
          icon={locked ? LockOpen : Lock}
          aria-pressed={locked}
          disabled={!detected}
          onClick={() => update({ bibleLocked: !locked })}
          title={detected ? undefined : "Find or add characters first."}
        >
          {locked ? "Unlock bible" : "Lock bible"}
        </Button>
        {locked && detected && scenesWithoutCast && (
          <Button disabled={busy} onClick={() => void detect(true)}>
            Fill who is in each scene
          </Button>
        )}
        {locked && <span className="text-xs text-muted">Locked: prompts use these texts exactly. Unlock to edit.</span>}
      </div>
      {job && <JobBar job={job} />}

      {!detected && !busy && (
        <p className="text-sm text-muted">Press Auto detect and Gemini reads your script, or add people and places yourself below.</p>
      )}

      <section aria-label="Characters" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Characters ({characters.length})</h3>
          <Button icon={Plus} disabled={locked} onClick={() => update({ characterBible: [...characters, newCharacter(characters)] })}>
            Add character
          </Button>
        </div>
        {characters.length === 0 ? (
          <p className="text-sm text-muted" role="status">
            {detected ? "No characters found. Only locations are used in the prompts." : "No characters yet."}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                item={character}
                scenes={counts[character.id] ?? 0}
                locked={locked}
                onChange={(next) => update({ characterBible: characters.map((c) => (c.id === character.id ? next : c)) })}
                onDelete={() => {
                  const result = removeCharacter(characters, scenes, character.id);
                  update({ characterBible: result.characters, scenes: result.scenes });
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Locations" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Locations ({locations.length})</h3>
          <Button icon={Plus} disabled={locked} onClick={() => update({ locationBible: [...locations, newLocation(locations)] })}>
            Add location
          </Button>
        </div>
        {locations.length === 0 ? (
          <p className="text-sm text-muted">No locations yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {locations.map((location) => (
              <LocationCard
                key={location.id}
                item={location}
                scenes={counts[location.id] ?? 0}
                locked={locked}
                onChange={(next) => update({ locationBible: locations.map((l) => (l.id === location.id ? next : l)) })}
                onDelete={() => {
                  const result = removeLocation(locations, scenes, location.id);
                  update({ locationBible: result.locations, scenes: result.scenes });
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
