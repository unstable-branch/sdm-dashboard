import type { UploadFile } from "@/services/types";

export function readCleanedCount(value: Record<string, unknown>): number | null {
  const count = value.valid_records;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

type UploadCount = Pick<UploadFile, "cleaned_valid_records" | "cleaned" | "cleanedAssetId" | "cleaned_asset_id" | "cleaned_file_id">;

export function aggregateCleanedCounts(uploads: UploadCount[]): number | null {
  const cleaned = uploads.filter((upload) => upload.cleaned || upload.cleanedAssetId || upload.cleaned_asset_id || upload.cleaned_file_id);
  if (cleaned.length === 0) return null;
  let total = 0;
  for (const upload of cleaned) {
    const count = upload.cleaned_valid_records;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
    total += count;
  }
  return total;
}

export function displayCleanedCount(upload: UploadCount): string {
  const count = upload.cleaned_valid_records;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count.toLocaleString()
    : "Count unavailable";
}
