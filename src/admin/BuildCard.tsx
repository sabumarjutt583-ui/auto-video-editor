import { Package } from "lucide-react";
import { useState } from "react";

import { Button, Card } from "../components/ui";
import { adminBuildPackage, type AdminOverview, type BuiltPackage } from "./api";

interface Props {
  overview: AdminOverview;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

function size(bytes: number): string {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Builds the zip and manifest to upload to the release location. */
export function BuildCard({ overview, act }: Props) {
  const [built, setBuilt] = useState<Record<string, BuiltPackage>>({});
  const build = (kind: "sfx" | "styles") => void act(() => adminBuildPackage(kind, null)).then((p) => p && setBuilt((b) => ({ ...b, [kind]: p })));
  const rows = [
    { kind: "sfx" as const, label: "Sound effects", version: overview.nextSfxVersion, count: overview.sounds.sounds.length },
    { kind: "styles" as const, label: "Styles", version: overview.nextStylesVersion, count: overview.styles.length },
  ];
  return (
    <Card title="Build packages" description={`Files are written to ${overview.packagesDir}. Upload the zip and its manifest to the update address.`} icon={Package}>
      {rows.map((r) => (
        <div key={r.kind} className="flex flex-col gap-1 rounded-xl border border-line bg-surface-2 p-3" data-testid={`build-${r.kind}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{r.label}: {r.count} → version {r.version}</span>
            <Button variant="primary" disabled={r.count === 0} onClick={() => build(r.kind)}>
              Build library package
            </Button>
          </div>
          {built[r.kind] && (
            <p className="text-xs text-muted" role="status">
              Built version {built[r.kind]?.version}: {built[r.kind]?.count} items, {size(built[r.kind]?.sizeBytes ?? 0)}. {built[r.kind]?.zipPath} and {built[r.kind]?.manifestPath}. SHA-256 {built[r.kind]?.sha256.slice(0, 12)}…
            </p>
          )}
        </div>
      ))}
    </Card>
  );
}
