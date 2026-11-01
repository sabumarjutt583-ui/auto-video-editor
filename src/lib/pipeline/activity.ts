/** One project owns the production workspace until its run (including saving) ends. */
let active: { id: string } | null = null;

export function isProjectActive(id: string): boolean { return active?.id === id; }

export function assertProjectAvailable(id: string | null): void {
  if (active && active.id !== id) {
    throw new Error("A video is being made. Cancel it and wait for it to stop before switching or closing projects.");
  }
}

export function assertProjectDeletable(id: string): void {
  assertProjectIdle(id, "deleting it");
}

export function assertProjectIdle(id: string, action: string): void {
  if (active?.id === id) throw new Error(`This video is being made. Cancel it and wait for it to stop before ${action}.`);
}

export function acquireProject(id: string): () => void {
  if (active) throw new Error("Another video is already being made.");
  const owner = { id };
  active = owner;
  return () => { if (active === owner) active = null; };
}
