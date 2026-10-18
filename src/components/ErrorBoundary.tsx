import { Component, type ErrorInfo, type ReactNode } from "react";

import { logFrontendError } from "../lib/appUpdate/api";
import { Button } from "./ui";

interface State {
  failed: boolean;
  details: string;
}

/** If a page breaks while drawing, show a calm message instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false, details: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, details: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    void logFrontendError(`A page broke: ${error instanceof Error ? error.message : String(error)} ${info.componentStack?.split("\n").slice(0, 4).join(" ") ?? ""}`).catch(() => undefined);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-app p-8 text-center text-fg" role="alert">
        <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
        <p className="max-w-md text-sm text-muted">Your projects are safe: they are saved all the time. Please reload. If it happens again, use Settings → Help and logs → Export logs and send the file to support.</p>
        <details className="max-w-xl text-xs text-muted">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-2 break-words">{this.state.details}</p>
        </details>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
