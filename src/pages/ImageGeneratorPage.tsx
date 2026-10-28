import { useState } from "react";

import { EngineBar } from "../components/imagegen/EngineBar";
import { FlowBatchPanel } from "../components/imagegen/FlowBatchPanel";
import { OnlyImagesView } from "../components/imagegen/OnlyImagesView";
import { ProjectImagesView } from "../components/imagegen/ProjectImagesView";
import { SegmentedControl } from "../components/ui";
import { useImageGenStore } from "../store/imagegenStore";

type Mode = "project" | "only";

const MODES = [
  { value: "project", label: "Project scenes" },
  { value: "only", label: "Only images" },
] as const;

export function ImageGeneratorPage() {
  const snapshot = useImageGenStore((state) => state.snapshot);
  const saveSettings = useImageGenStore((state) => state.saveSettings);
  const [mode, setMode] = useState<Mode>("project");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <SegmentedControl label="Image Generator mode" options={MODES} value={mode} onChange={setMode} />
      {snapshot && <EngineBar snapshot={snapshot} onChange={(patch) => void saveSettings(patch)} />}
      <FlowBatchPanel />
      {mode === "project" ? <ProjectImagesView /> : <OnlyImagesView />}
    </div>
  );
}
