import { useSettingsStore } from "../../store/settingsStore";
import { SaveStatus } from "../SaveStatus";

/** Settings are saved automatically after each change. */
export function SaveIndicator() {
  const saveState = useSettingsStore((state) => state.saveState);
  return <SaveStatus state={saveState} />;
}
