import type { ManifestData } from "@/services/types";

export function manifestRecordCount(manifest: ManifestData): number | null {
  const count = manifest.data?.record_count ?? manifest.data?.occurrence_rows;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}
