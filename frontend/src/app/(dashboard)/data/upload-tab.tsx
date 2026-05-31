"use client";

import { FileUpload } from "@/components/data/file-upload";
import { DetectedColumns } from "@/components/data/detected-columns";
import { PreviewTable } from "@/components/data/preview-table";
import { Loader2, AlertTriangle } from "lucide-react";

interface UploadTabProps {
  uploadResult: Record<string, unknown> | null;
  uploadLoading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onSelectUpload: (file: Record<string, unknown>) => void;
  onTabChange: (tab: string) => void;
  previousUploads: Array<Record<string, unknown>>;
  previousUploadsLoading: boolean;
}

export function UploadTab({
  uploadResult, uploadLoading, uploadError, onUpload, onSelectUpload, onTabChange,
  previousUploads, previousUploadsLoading,
}: UploadTabProps) {
  const uploadPreview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const cols = uploadResult?.columns_detected as Record<string, string | null> | undefined;
  const warnings = uploadResult?.coord_warnings as string[] | undefined;
  const hasWarnings = warnings && warnings.length > 0;
  const hasResult = typeof uploadResult?.file_path === "string";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h2 className="text-lg font-semibold text-sdm-heading mb-4">Upload occurrence file</h2>
        <p className="text-sm text-sdm-muted mb-4">
          Upload a CSV, TSV, or ZIP file containing occurrence records.
        </p>
        <details className="mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-sdm-heading">
            Preparing detection-history data for occupancy models
          </summary>
          <div className="px-4 pb-4 space-y-2 text-xs text-sdm-muted">
            <p>Occupancy models require detection/non-detection data with repeated surveys at each site.</p>
            <pre className="bg-sdm-surface p-3 rounded overflow-x-auto mt-2">{`site_id,longitude,latitude,survey_1,survey_2,survey_3,elevation
site_A,140.0,-23.0,1,0,1,200
site_B,141.5,-24.0,0,1,0,450`}</pre>
          </div>
        </details>
        <FileUpload onUpload={onUpload} loading={uploadLoading} error={uploadError} />
      </div>

      {cols && Object.keys(cols).length > 0 && <DetectedColumns columns={cols} />}
      {hasWarnings && (
        <div className="rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 text-sm text-sdm-warning">
          <AlertTriangle className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          {warnings.join("; ")}
        </div>
      )}
      {uploadPreview && uploadPreview.length > 0 && <PreviewTable data={uploadPreview} title="Preview (first 5 records)" />}
      {hasResult && (
        <div className="flex items-center justify-between rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-sdm-warning">
            <AlertTriangle className="h-4 w-4" />
            <span>{Number(uploadResult.n_rows ?? 0).toLocaleString()} records uploaded — clean before modeling.</span>
          </div>
          <button onClick={() => onTabChange("clean")} className="text-sm font-medium text-sdm-accent hover:underline">Clean data →</button>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h3 className="text-sm font-semibold text-sdm-heading mb-3">Previous uploads</h3>
        {previousUploadsLoading ? (
          <div className="flex items-center gap-2 text-sm text-sdm-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : previousUploads.length === 0 ? (
          <p className="text-sm text-sdm-muted">No previous uploads found.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {previousUploads.map((f, idx) => {
              const isSelected = uploadResult?.file_id === f.file_id;
              const sizeStr = (f.file_size as number) > 1024 * 1024
                ? `${((f.file_size as number) / 1024 / 1024).toFixed(1)} MB`
                : `${((f.file_size as number) / 1024).toFixed(0)} KB`;
              return (
                <div key={String(f.file_id ?? idx)}
                  className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-sm transition-colors ${
                    isSelected ? "border-sdm-accent bg-sdm-accent/5" : "border-sdm-border bg-sdm-surface-soft hover:border-sdm-accent/50"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sdm-text truncate">
                      {f.file_name as string}
                      {(f as any).cleaned && <span className="ml-1.5 inline-flex items-center rounded-full bg-sdm-success/10 px-1.5 py-0.5 text-xs font-medium text-sdm-success">Cleaned</span>}
                    </p>
                    <p className="text-xs text-sdm-muted">
                      {sizeStr}{(f.n_rows as number) > 0 && ` · ${(f.n_rows as number).toLocaleString()} rows`}
                    </p>
                  </div>
                  {isSelected ? (
                    <span className="shrink-0 text-xs font-medium text-sdm-accent ml-3">Selected</span>
                  ) : (
                    <button onClick={() => onSelectUpload(f)}
                      className="shrink-0 rounded border border-sdm-border bg-sdm-surface px-3 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft ml-3">Use</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
