import { useEffect, useId, type ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** A wider dialog that scrolls when its content is tall (for forms). */
  wide?: boolean;
}

/** A centered dialog over a dimmed background. Escape or a click outside closes it. */
export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full rounded-2xl border border-line bg-surface p-6 shadow-card ${wide ? "max-h-[90vh] max-w-3xl overflow-y-auto" : "max-w-md"}`}
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <div className="mt-4 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
