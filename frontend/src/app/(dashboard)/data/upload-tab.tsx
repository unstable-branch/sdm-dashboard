"use client";

import { useState } from "react";
import Link from "next/link";
import { FileUpload } from "@/components/data/file-upload";
import { DetectedColumns } from "@/components/data/detected-columns";
import { PreviewTable } from "@/components/data/preview-table";
import { Loader2, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import type { UploadFile } from "@/services/types";

interface UploadTabProps {
  uploadResult: Record<string, unknown> | null;
  uploadLoading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onSelectUpload: (file: UploadFile) => void;
  onDelete: (fileId: string) => void;
  onTabChange: (tab: string) => void;
  previousUploads: UploadFile[];
  previousUploadsLoading: boolean;
}

export function UploadTab({
  uploadResult, uploadLoading, uploadError, onUpload, onSelectUpload, onDelete, onTabChange,
  previousUploads, previousUploadsLoading,
}: UploadTabProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const uploadPreview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const cols = uploadResult?.columns_detected as Record<string, string | null> | undefined;
  const warningsRaw = uploadResult?.coord_warnings;
  const warnings = Array.isArray(warningsRaw) ? warningsRaw : (warningsRaw ? [String(warningsRaw)] : []);
  const hasWarnings = warnings.length > 0;
  const hasResult = typeof uploadResult?.file_path === "string";

  const handleDelete = async (fileId: string) => {
    setDeleting(fileId);
    try {
      await onDelete(fileId);
      setConfirmDelete(null);
    } catch {
    } finally {
      setDeleting(null);
    }
  };

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
        <FileUpload key={String(uploadResult?.file_id ?? "new")} onUpload={onUpload} loading={uploadLoading} error={uploadError} />
      </div>

      {cols && Object.keys(cols).length > 0 && <DetectedColumns columns={cols} />}
      {hasWarnings && (
        <div className="rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 text-sm text-sdm-warning">
          <AlertTriangle className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          {warnings.join("; ")}
        </div>
      )}
      {uploadPreview && uploadPreview.length > 0 && <PreviewTable data={uploadPreview} title="Preview (first 5 records)" />}

      {hasResult && Array.isArray(uploadResult?.datasets) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Datasets</p>
            <p className="mt-1 text-xl font-bold text-sdm-heading">{String((uploadResult.datasets as unknown[]).length)}</p>
          </div>
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Returned</p>
            <p className="mt-1 text-xl font-bold text-sdm-accent">{(uploadResult.n_rows ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Raw records</p>
            <p className="mt-1 text-xl font-bold text-sdm-heading">{(uploadResult.n_raw ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Format</p>
            <p className="mt-1 text-xl font-bold text-sdm-heading">Darwin Core</p>
          </div>
        </div>
      )}

      {hasResult && uploadResult?.cleaned ? (
        <div className="flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-green-500">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Previously cleaned — {Number(uploadResult.cleaned_valid_records ?? uploadResult.n_rows ?? 0).toLocaleString()} valid records ready.</span>
          </div>
          <Link href="/model" className="text-sm font-medium text-sdm-accent hover:underline">
            Run SDM →
          </Link>
        </div>
      ) : hasResult && (
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
              const isSelected = !!uploadResult?.file_id && uploadResult.file_id === f.file_id;
              const sizeStr = (f.file_size as number) > 1024 * 1024
                ? `${((f.file_size as number) / 1024 / 1024).toFixed(1)} MB`
                : `${((f.file_size as number) / 1024).toFixed(0)} KB`;
              return (
                <div key={String(f.file_id ?? idx)}
                  className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-sm transition-colors ${
                    isSelected ? "border-sdm-accent bg-sdm-accent/5" : "border-sdm-border bg-sdm-surface-soft hover:border-sdm-accent/50"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sdm-text truncate">
                      {f.file_name}
                      {f.format && (
                        <span className={`ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-xs font-medium ${
                          f.format === "dwca" ? "bg-blue-500/10 text-blue-400" :
                          f.format === "tsv" ? "bg-amber-500/10 text-amber-400" :
                          "bg-green-500/10 text-green-400"
                        }`}>{f.format.toUpperCase()}</span>
                      )}
                      {f.species && <span className="ml-1.5 text-xs text-sdm-muted">— {f.species}</span>}
                      {f.cleaned || f.cleaned_file_id ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-sdm-success/10 px-1.5 py-0.5 text-xs font-medium text-sdm-success">
                          <CheckCircle2 className="h-3 w-3" /> Cleaned
                        </span>
                      ) : (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-sdm-warning/10 px-1.5 py-0.5 text-xs font-medium text-sdm-warning">
                          <AlertTriangle className="h-3 w-3" /> Uncleaned
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-sdm-muted">
                      {sizeStr}{f.n_rows > 0 && ` · ${f.n_rows.toLocaleString()} rows`}{f.modified_at && ` · ${new Date(f.modified_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {confirmDelete === f.file_id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-sdm-warning flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Delete?
                        </span>
                        <button onClick={() => handleDelete(f.file_id)} disabled={deleting === f.file_id}
                          className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs disabled:opacity-50">
                          {deleting === f.file_id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                        </button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="px-2 py-0.5 rounded bg-sdm-surface-soft text-sdm-muted hover:text-sdm-text text-xs">
                          No
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(f.file_id)}
                        className="rounded p-1 text-sdm-muted hover:text-red-400 transition-colors" title="Delete upload">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isSelected ? (
                      <span className="text-xs font-medium text-sdm-accent ml-1">Selected</span>
                    ) : (
                      <button onClick={() => onSelectUpload(f)}
                        className="rounded border border-sdm-border bg-sdm-surface px-3 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft">Use</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
