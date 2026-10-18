import { Outlet } from "react-router-dom";

import { useProjectStore } from "../store/projectStore";
import { useSettingsStore } from "../store/settingsStore";
import { ErrorNotice } from "./ErrorNotice";
import { OnboardingModal } from "./onboarding";
import { Sidebar } from "./Sidebar";
import { AppUpdateBanner } from "./support";
import { TopBar } from "./TopBar";

/** Sidebar + top bar around the current page. */
export function AppShell() {
  const saveError = useProjectStore((state) => state.saveError);
  const showOnboarding = useSettingsStore((state) => state.settings !== null && !state.settings.onboardingDone);

  return (
    <div className="flex h-full bg-app text-fg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <AppUpdateBanner />
        {saveError && (
          <div className="px-6 pt-4">
            <ErrorNotice error={saveError} />
          </div>
        )}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      {showOnboarding && <OnboardingModal />}
    </div>
  );
}
