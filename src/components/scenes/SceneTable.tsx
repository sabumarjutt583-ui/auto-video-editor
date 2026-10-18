import { splitChoices } from "../../lib/scenes/video";
import type { Sentence } from "../../lib/sentences";
import type { Character, Location, MediaType, Scene, Word } from "../../types";
import { SceneRow } from "./SceneRow";

interface SceneTableProps {
  scenes: readonly Scene[];
  words: readonly Word[];
  sentences: readonly Sentence[];
  characters: readonly Character[];
  locations: readonly Location[];
  onToggleCharacter: (index: number, id: string) => void;
  onLocation: (index: number, id: string | null) => void;
  onMedia: (index: number, type: MediaType) => void;
  onMerge: (index: number) => void;
  onSplit: (index: number, wordIndex: number) => void;
  onText: (index: number, text: string) => void;
}

/** The scenes, one row each. */
export function SceneTable({ scenes, words, sentences, characters, locations, onToggleCharacter, onLocation, onMedia, onMerge, onSplit, onText }: SceneTableProps) {
  return (
    <ol className="flex max-h-[34rem] flex-col gap-2 overflow-y-auto pr-1" aria-label="Scenes">
      {scenes.map((scene, index) => (
        <SceneRow
          key={`${scene.id}-${scene.firstWord}`}
          scene={scene}
          words={words}
          isLast={index === scenes.length - 1}
          choices={splitChoices(scene, words, sentences)}
          characters={characters}
          locations={locations}
          onToggleCharacter={(id) => onToggleCharacter(index, id)}
          onLocation={(id) => onLocation(index, id)}
          onMedia={(type) => onMedia(index, type)}
          onMerge={() => onMerge(index)}
          onSplit={(wordIndex) => onSplit(index, wordIndex)}
          onText={(text) => onText(index, text)}
        />
      ))}
    </ol>
  );
}
