import { Check, Lock } from "lucide-react";

import { cn } from "../../lib/cn";
import { STEPS, type StepAccess, type StepId } from "../../lib/steps";

interface StepTabsProps {
  current: StepId;
  access: Record<StepId, StepAccess>;
  onSelect: (step: StepId) => void;
}

/** The five steps of the Prompt Generator. Steps that are not ready yet are dimmed. */
export function StepTabs({ current, access, onSelect }: StepTabsProps) {
  return (
    <nav aria-label="Prompt Generator steps" className="flex flex-wrap gap-2">
      {STEPS.map((step, index) => {
        const { enabled, done, reason } = access[step.id];
        const selected = step.id === current;
        return (
          <button
            key={step.id}
            type="button"
            disabled={!enabled}
            aria-current={selected ? "step" : undefined}
            title={enabled ? undefined : reason}
            onClick={() => onSelect(step.id)}
            className={cn(
              "inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected ? "border-accent bg-accent-soft text-accent-fg" : "border-line bg-surface text-muted hover:text-fg",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                done ? "bg-success text-app" : "bg-surface-2",
              )}
            >
              {done ? <Check size={12} aria-hidden /> : enabled ? index + 1 : <Lock size={11} aria-hidden />}
            </span>
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}
