import { lazy, Suspense, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components";
import { listenJobProgress } from "./lib/jobs";
import { DEFAULT_PATH } from "./lib/nav";
import {
  AutoEditorPage,
  ImageGeneratorPage,
  ProjectsPage,
  PromptGeneratorPage,
  SettingsPage,
  SfxLibraryPage,
} from "./pages";
import { shouldAutoCheck, STARTUP_DELAY_MS } from "./lib/appUpdate/schedule";
import { useAppUpdateStore } from "./store/appUpdateStore";
import { useLibraryStore } from "./store/libraryStore";
import { useJobStore } from "./store/jobStore";
import { useProjectStore } from "./store/projectStore";
import { useImageGenStore } from "./store/imagegenStore";
import { useSettingsStore } from "./store/settingsStore";

// Loaded only in the Admin Edition. In the user build this line becomes `null` and the admin code is not in the bundle.
const AdminPage = import.meta.env.VITE_ADMIN === "true" ? lazy(() => import("./admin/AdminPage")) : null;

export function App() {
  // Load the saved settings once when the app starts.
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // New sounds and styles: look quietly once the settings are known. An offline computer is not an error here.
  const settingsLoaded = useSettingsStore((s) => s.settings !== null);
  useEffect(() => {
    if (!settingsLoaded) return;
    void useLibraryStore.getState().refresh();
    if (useSettingsStore.getState().settings?.libraryUpdateUrl) void useLibraryStore.getState().check(true);
  }, [settingsLoaded]);

  // App updates: wait 5 seconds after the start, then look quietly (switched on, at most once a day).
  useEffect(() => {
    if (!settingsLoaded) return undefined;
    const timer = window.setTimeout(() => {
      const saved = useSettingsStore.getState().settings;
      if (saved && shouldAutoCheck(saved.autoCheckAppUpdates, saved.lastAppUpdateCheck, Math.floor(Date.now() / 1000))) {
        void useAppUpdateStore.getState().check(true);
      }
    }, STARTUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [settingsLoaded]);

  // Progress of background jobs (FFmpeg, transcription) arrives as events.
  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void listenJobProgress((progress) => useJobStore.getState().report(progress)).then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, []);

  // The Image Generator listens from the start, so pictures made while another page is open reach the project.
  useEffect(() => {
    void useImageGenStore.getState().init();
  }, []);

  // Save a pending project change when the window is hidden or closed (best effort).
  useEffect(() => {
    function saveWhenHidden() {
      if (document.visibilityState === "hidden") void useProjectStore.getState().flush();
    }
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => document.removeEventListener("visibilitychange", saveWhenHidden);
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={DEFAULT_PATH} replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/prompt-generator" element={<PromptGeneratorPage />} />
          <Route path="/image-generator" element={<ImageGeneratorPage />} />
          <Route path="/auto-editor" element={<AutoEditorPage />} />
          <Route path="/sfx-library" element={<SfxLibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {AdminPage && (
            <Route path="/admin" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
          )}
          <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
