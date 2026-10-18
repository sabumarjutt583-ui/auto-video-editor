interface PlaceholderPageProps {
  title: string;
}

/** Empty card with the page title, used until each page is built. */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-8 shadow-card">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted">Nothing here yet.</p>
    </section>
  );
}
