import { AlertTriangle } from "lucide-react";
import Link from "next/link";
type CleanedOccurrence = {
  filePath: string;
  cleanedAssetId?: string;
  df: Record<string, unknown>[];
  sourceCounts: Record<string, number>;
  nAbsentExcluded: number;
  originalRows: number;
  validRecords: number | null;
} | null;

interface ModelDataSourceProps {
  occurrenceFile: string | null;
  recordCount: number;
  cleanedOccurrence: CleanedOccurrence;
  species: string;
}

export function ModelDataSource({ occurrenceFile, recordCount, cleanedOccurrence, species }: ModelDataSourceProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
      <h2 className="text-sm font-semibold text-sdm-heading mb-3">Data source</h2>
      {cleanedOccurrence?.cleanedAssetId ? (
        <div>
          <p className="text-sm text-sdm-text font-medium">Cleaned occurrence data</p>
          <p className="text-xs text-sdm-muted mt-1">{cleanedOccurrence.originalRows.toLocaleString()} original → {cleanedOccurrence.validRecords === null ? "cleaned count unavailable" : `${cleanedOccurrence.validRecords.toLocaleString()} cleaned records`}</p>
          <p className="text-xs text-sdm-accent mt-1"><Link href="/data?tab=upload" className="underline">Review on Data page</Link></p>
          {species && species !== "Untitled species" && (
            <p className="text-xs text-sdm-accent mt-1">Species: {species}</p>
          )}
        </div>
      ) : occurrenceFile ? (
        <div>
          <div className="flex items-center gap-2 text-sm text-sdm-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="text-sm text-sdm-text font-mono truncate">{typeof occurrenceFile === "string" ? occurrenceFile.split("/").pop() : String(occurrenceFile)}</p>
          </div>
          <p className="text-xs text-sdm-muted mt-1">{recordCount.toLocaleString()} records loaded</p>
          <p className="text-xs text-sdm-warning mt-1">Not cleaned. <Link href="/data?tab=upload" className="underline">Clean on Data page</Link> first.</p>
          {species && species !== "Untitled species" && (
            <p className="text-xs text-sdm-accent mt-1">Species: {species}</p>
          )}
        </div>
      ) : (
        <Link href="/data?tab=upload" className="text-xs text-sdm-accent underline hover:no-underline">
          Upload occurrence data in the Data tab first.
        </Link>
      )}
    </div>
  );
}
