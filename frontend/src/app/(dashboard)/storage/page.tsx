"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiDelete } from "@/services/api";
import { Loader2, HardDrive, Trash2, Database, FolderOpen, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface UploadedFile {
  file_id: string;
  file_name: string;
  file_size: number;
  n_rows: number;
  modified_at: string;
  cleaned: boolean;
  deleting?: boolean;
}

interface RunRecord {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  deleting?: boolean;
}

export default function StoragePage() {
  const [storageInfo, setStorageInfo] = useState<{
    quota_bytes: number;
    used_bytes: number;
    available_bytes: number;
    quota_mb: number;
    used_mb: number;
    pct_used: number;
  } | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "file" | "run"; id: string; label: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [storage, uploadsRes, runsRes] = await Promise.all([
        apiGet<typeof storageInfo>("/api/v1/data/storage"),
        apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/occurrences/uploads"),
        apiGet<RunRecord[]>("/api/v1/sdm/runs"),
      ]);
      setStorageInfo(storage);
      setUploadedFiles((uploadsRes.uploads || []).map((f) => ({
        file_id: f.file_id as string,
        file_name: f.file_name as string,
        file_size: f.file_size as number,
        n_rows: f.n_rows as number,
        modified_at: f.modified_at as string,
        cleaned: f.cleaned as boolean,
      })));
      setRuns(Array.isArray(runsRes) ? runsRes.filter((r) => r.status !== "running" && r.status !== "queued") : []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    if (type === "file") {
      setUploadedFiles((prev) => prev.map((f) => f.file_id === id ? { ...f, deleting: true } : f));
      try {
        await apiDelete(`/api/v1/data/uploads/${encodeURIComponent(id)}`);
        await loadData();
      } catch {
        setUploadedFiles((prev) => prev.map((f) => f.file_id === id ? { ...f, deleting: false } : f));
      }
    } else {
      setRuns((prev) => prev.map((r) => r.id === id ? { ...r, deleting: true } : r));
      try {
        await apiDelete(`/api/v1/sdm/runs/delete/${id}`);
        await loadData();
      } catch {
        setRuns((prev) => prev.map((r) => r.id === id ? { ...r, deleting: false } : r));
      }
    }
    setConfirmDelete(null);
  }, [confirmDelete, loadData]);

  const totalRunSize = runs.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-sdm-muted" />
      </div>
    );
  }

  const pct = storageInfo?.pct_used ?? 0;
  const barColor = pct > 90 ? "bg-sdm-danger" : pct > 70 ? "bg-sdm-warning" : "bg-sdm-accent";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Storage</h1>
        <p className="text-sdm-muted mt-1">
          Manage uploaded files and model outputs to free up disk space.
        </p>
      </div>

      {/* Storage usage */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-sdm-muted" />
            <h2 className="text-lg font-semibold text-sdm-heading">Usage</h2>
          </div>
          <button onClick={loadData} className="inline-flex items-center gap-1 text-xs text-sdm-muted hover:text-sdm-accent transition-colors">
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-sdm-muted">
              {storageInfo?.used_mb ?? 0} MB used of {storageInfo?.quota_mb ?? 500} MB
            </span>
            <span className={pct > 90 ? "text-red-500 font-medium" : "text-sdm-muted"}>
              {pct}%
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-sdm-surface-soft overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Uploaded files */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface">
        <div className="border-b border-sdm-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-sdm-muted" />
            <h2 className="text-lg font-semibold text-sdm-heading">Uploaded occurrence files</h2>
          </div>
          <p className="text-sm text-sdm-muted mt-1">
            {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""} — delete files you no longer need.
          </p>
        </div>
        {uploadedFiles.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-sdm-muted">No uploaded files yet.</div>
        ) : (
          <div className="divide-y divide-sdm-border">
            {uploadedFiles.map((file) => (
              <div key={file.file_id} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-sdm-text truncate">{file.file_name}</p>
                  <p className="text-xs text-sdm-muted">
                    {(file.file_size / (1024 * 1024)).toFixed(1)} MB
                    {file.n_rows > 0 && ` · ${file.n_rows.toLocaleString()} records`}
                    {file.cleaned && " · cleaned"}
                    {` · ${new Date(file.modified_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDelete({ type: "file", id: file.file_id, label: file.file_name })}
                  disabled={file.deleting}
                  className="ml-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/30 transition-colors disabled:opacity-50"
                >
                  {file.deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {file.deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Runs (completed/failed/cancelled — deletable) */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface">
        <div className="border-b border-sdm-border px-6 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-sdm-muted" />
            <h2 className="text-lg font-semibold text-sdm-heading">Model runs</h2>
          </div>
          <p className="text-sm text-sdm-muted mt-1">
            {totalRunSize} run{totalRunSize !== 1 ? "s" : ""} — deleting a run removes its outputs and frees disk space.
          </p>
        </div>
        {runs.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-sdm-muted">No completed or failed runs available for deletion.</div>
        ) : (
          <div className="divide-y divide-sdm-border">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-sdm-text truncate">{run.species || "Unknown species"}</p>
                  <p className="text-xs text-sdm-muted">
                    {run.model_id} · status: {run.status}
                    {` · ${new Date(run.started_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDelete({ type: "run", id: run.id, label: `${run.species || "Unknown"} (${run.model_id})` })}
                  disabled={run.deleting}
                  className="ml-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/30 transition-colors disabled:opacity-50"
                >
                  {run.deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {run.deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete?.type === "file" ? "Delete file" : "Delete run"}
        message={`Delete "${confirmDelete?.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDeleteAction}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}