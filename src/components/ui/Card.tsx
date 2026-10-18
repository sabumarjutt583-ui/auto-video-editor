import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
}

/** A rounded card with a title, used for each group of settings. */
export function Card({ title, description, icon: Icon, children }: CardProps) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-card">
      <header className="mb-5 flex items-start gap-3">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
            <Icon size={18} aria-hidden />
          </span>
        )}
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
