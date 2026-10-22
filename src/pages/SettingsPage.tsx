import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";

import { ErrorNotice } from "../components/ErrorNotice";
import {
  ApiKeyCard,
  DefaultsCard,
  EncodingCard,
  FallbackCard,
  TextEngineCard,
  ImageGeneratorCard,
  ModelsCard,
  SaveIndicator,
} from "../components/settings";
import { LibraryUrlCard } from "../components/library";
import { AboutCard, AppUpdateCard, SupportCard } from "../components/support";
import { Button } from "../components/ui";
import { useKeyStore } from "../store/keyStore";
import { useSettingsStore } from "../store/settingsStore";

export function SettingsPage() {
  const settings = useSettingsStore((state) => state.settings);
  const loading = useSettingsStore((state) => state.loading);
  const loadError = useSettingsStore((state) => state.loadError);
  const saveError = useSettingsStore((state) => state.saveError);
  const load = useSettingsStore((state) => state.load);
  const update = useSettingsStore((state) => state.update);

  const keychainError = useKeyStore((state) => state.error);
  const refreshKeys = useKeyStore((state) => state.refreshAll);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <ShieldCheck size={16} aria-hidden className="shrink-0 text-success" />
          Your API keys are kept in your computer&apos;s secure keychain, never in files.
        </p>
        <SaveIndicator />
      </div>

      {keychainError && <ErrorNotice error={keychainError} />}
      {saveError && <ErrorNotice error={saveError} />}

      <ApiKeyCard
        provider="groq"
        title="Voice and Timing (Groq)"
        description="Turns your voice-over into exact word timings."
        linkLabel="Get a free Groq key"
        link="groq_keys"
      />
      <ApiKeyCard
        provider="gemini"
        title="Scenes and Prompts (Gemini)"
        description="Splits your script into scenes and writes the image prompts."
        linkLabel="Get a free Gemini key"
        link="gemini_keys"
        testModel={settings?.geminiModel}
      />

      <ApiKeyCard
        provider="openai"
        title="Look at pictures (OpenAI, optional)"
        description="An alternative to Gemini for studying reference pictures when you make a custom style."
        linkLabel="Get an OpenAI key"
        link="openai_keys"
      />

      <ImageGeneratorCard />

      {settings ? (
        <>
          <ModelsCard settings={settings} onChange={update} />
          <TextEngineCard settings={settings} onChange={update} />
          <FallbackCard settings={settings} onChange={update} />
          <DefaultsCard settings={settings} onChange={update} />
          <EncodingCard settings={settings} onChange={update} />
          <LibraryUrlCard settings={settings} onChange={update} />
          <AppUpdateCard settings={settings} onChange={update} />
          <SupportCard settings={settings} onChange={update} />
          <AboutCard />
        </>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorNotice error={loadError} />
          <Button onClick={() => void load()} loading={loading}>
            Try again
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Loading settings…</p>
      )}
    </div>
  );
}
