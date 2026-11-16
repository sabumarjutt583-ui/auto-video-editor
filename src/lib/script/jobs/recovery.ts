import type { ScriptJobRecoveryInspection, ScriptRecoveryArtifact } from "./types.ts";

/** Frontend display-only guards. Rust independently checks every path/owner. */
export function canInspectUnverifiedOrphan(
  report: ScriptJobRecoveryInspection | null,
  artifactId: string,
  acknowledged: boolean,
): boolean {
  if (!report || !acknowledged || report.reconciliationSupported) return false;
  return report.artifacts.some(item => item.artifactId === artifactId
    && item.kind === "orphan_revision"
    && item.canReadText
    && !item.attachmentProven
    && item.byteLength !== null && item.byteLength > 0
    && item.byteLength <= 2_097_152
    && typeof item.contentDigest === "string"
    && /^sha256:[\da-f]{64}$/i.test(item.contentDigest));
}

export function recoveryArtifactCounts(artifacts: readonly ScriptRecoveryArtifact[]): {
  readonly orphaned: number;
  readonly incomplete: number;
  readonly unsafeOrAmbiguous: number;
} {
  return {
    orphaned: artifacts.filter(x => x.kind === "orphan_revision").length,
    incomplete: artifacts.filter(x => x.kind === "incomplete_revision_temporary").length,
    unsafeOrAmbiguous: artifacts.filter(x =>
      x.kind === "unsafe_revision_entry" || x.kind === "ambiguous_revision").length,
  };
}
