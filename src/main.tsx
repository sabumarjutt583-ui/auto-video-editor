import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { logFrontendError } from "./lib/appUpdate/api";
import "./index.css";
import { initTheme } from "./store/themeStore";

initTheme();

// Anything nobody caught goes into the log file (the person sees nothing break).
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const text = typeof reason === "object" && reason !== null && "message" in reason ? String((reason as { message: unknown }).message) : String(reason);
  void logFrontendError(`Unhandled problem: ${text}`).catch(() => undefined);
});
window.addEventListener("error", (event) => {
  void logFrontendError(`Window error: ${event.message}`).catch(() => undefined);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
