"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiGet, apiDelete } from "@/services/api";
import { Loader2, HardDrive, Trash2, Database, FolderOpen, RefreshCw, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface UploadedFile {
  id?: string;
  file_id: string;
  file_name: string;
  file_size: number;
  n_rows: number;
  modified_at: string;
  cleaned: boolean;
}

interface RunRecord {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
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
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState<"file" | "run" | null>(null);
  const queryClient = useQueryClient();
  const fileSelectAllRef = useRef<HTMLInputElement>(null);
  const runSelectAllRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setSelectedFileIds(new Set());
    setSelectedRunIds(new Set());
    try {
      const [storage, uploadsRes, runsRes] = await Promise.all([
        apiGet<typeof storageInfo>("/api/v1/data/storage"),
        apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/occurrences/uploads"),
        apiGet<{ runs: RunRecord[] }>("/api/v1/sdm/runs"),
      ]);
      setStorageInfo(storage);
      setUploadedFiles((uploadsRes.uploads || []).map((f) => ({
        id: f.id as string,
        file_id: f.file_path as string,
        file_name: (f.filename as string) || (f.file_name as string) || "unknown",
        file_size: f.file_size as number,
        n_rows: f.n_rows as number,
        modified_at: f.created_at as string,
        cleaned: f.is_cleaned as boolean,
      })));
      setRuns(Array.isArray(runsRes.runs) ? runsRes.runs.filter((r) => r.status !== "running" && r.status !== "queued") : []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const toggleId = (prev: Set<string>, id: string) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const toggleFileSelected = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => toggleId(prev, fileId));
  }, []);

  const toggleRunSelected = useCallback((runId: string) => {
    setSelectedRunIds((prev) => toggleId(prev, runId));
  }, []);

  const toggleAllFiles = useCallback(() => {
    setSelectedFileIds((prev) => {
      const allIds = uploadedFiles.map((f) => f.file_id);
      return prev.size === allIds.length ? new Set() : new Set(allIds);
    });
  }, [uploadedFiles]);

  const toggleAllRuns = useCallback(() => {
    setSelectedRunIds((prev) => {
      const allIds = runs.map((r) => r.id);
      return prev.size === allIds.length ? new Set() : new Set(allIds);
    });
  }, [runs]);

  useEffect(() => {
    if (fileSelectAllRef.current) {
      const allFileIds = uploadedFiles.map((f) => f.file_id);
      const allSelected = selectedFileIds.size === allFileIds.length && allFileIds.length > 0;
      fileSelectAllRef.current.indeterminate = selectedFileIds.size > 0 && !allSelected;
    }
  }, [selectedFileIds, uploadedFiles]);

  useEffect(() => {
    if (runSelectAllRef.current) {
      const allRunIds = runs.map((r) => r.id);
      const allSelected = selectedRunIds.size === allRunIds.length && allRunIds.length > 0;
      runSelectAllRef.current.indeterminate = selectedRunIds.size > 0 && !allSelected;
    }
  }, [selectedRunIds, runs]);

  const batchDeleteFiles = useCallback(async () => {
    setBatchDeleting(true);
    const ids = Array.from(selectedFileIds);
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await apiDelete(`/api/v1/data/uploads/${encodeURIComponent(id)}`);
      } catch {
        errors.push(id);
      }
    }
    setBatchDeleting(false);
    setBatchConfirm(null);
    if (errors.length > 0) {
      alert(`Deleted ${ids.length - errors.length} file(s). ${errors.length} failed.`);
    }
    await loadData();
  }, [selectedFileIds, loadData]);

  const batchDeleteRuns = useCallback(async () => {
    setBatchDeleting(true);
    const ids = Array.from(selectedRunIds);
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await apiDelete(`/api/v1/sdm/runs/delete/${id}`);
      } catch {
        errors.push(id);
      }
    }
    setBatchDeleting(false);
    setBatchConfirm(null);
    queryClient.invalidateQueries({ queryKey: ["sdm-runs"] });
    if (errors.length > 0) {
      alert(`Deleted ${ids.length - errors.length} run(s). ${errors.length} failed.`);
    }
    await loadData();
  }, [selectedRunIds, loadData, queryClient]);

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
          <div className="flex items-center gap-3">
            <input
              ref={fileSelectAllRef}
              type="checkbox"
              checked={selectedFileIds.size === uploadedFiles.length && uploadedFiles.length > 0}
              onChange={toggleAllFiles}
              className="h-4 w-4 rounded border-sdm-border text-sdm-accent focus:ring-sdm-accent"
            />
            <Database className="h-5 w-5 text-sdm-muted shrink-0" />
            <h2 className="text-lg font-semibold text-sdm-heading">Uploaded occurrence files</h2>
            <span className="text-sm text-sdm-muted">{uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""}</span>
          </div>
          <p className="text-sm text-sdm-muted mt-1 ml-7">
            Select files to delete.
          </p>
        </div>
        {selectedFileIds.size > 0 && (
          <div className="flex items-center justify-between px-6 py-2.5 bg-sdm-danger/5 border-b border-sdm-danger/20">
            <span className="text-sm font-medium text-sdm-danger">{selectedFileIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBatchConfirm("file")}
                disabled={batchDeleting}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white bg-sdm-danger hover:bg-sdm-danger disabled:opacity-50"
              >
                {batchDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {batchDeleting ? "Deleting..." : "Delete selected"}
              </button>
              <button
                onClick={() => setSelectedFileIds(new Set())}
                disabled={batchDeleting}
                className="inline-flex items-center gap-1 text-xs text-sdm-muted hover:text-sdm-text disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
          </div>
        )}
        {uploadedFiles.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-sdm-muted">No uploaded files yet.</div>
        ) : (
          <div className="divide-y divide-sdm-border">
            {uploadedFiles.map((file) => {
              const checked = selectedFileIds.has(file.file_id);
              return (
                <div
                  key={file.id || file.file_id}
                  className={`flex items-center gap-3 px-6 py-3 transition-colors ${checked ? "bg-sdm-accent/[0.03]" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFileSelected(file.file_id)}
                    className="h-4 w-4 rounded border-sdm-border text-sdm-accent focus:ring-sdm-accent shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-sdm-text truncate">{file.file_name}</p>
                    <p className="text-xs text-sdm-muted">
                      {(file.file_size / (1024 * 1024)).toFixed(1)} MB
                      {file.n_rows > 0 && ` · ${file.n_rows.toLocaleString()} records`}
                      {file.cleaned && " · cleaned"}
                      {` · ${new Date(file.modified_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Runs (completed/failed/cancelled — deletable) */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface">
        <div className="border-b border-sdm-border px-6 py-4">
          <div className="flex items-center gap-3">
            <input
              ref={runSelectAllRef}
              type="checkbox"
              checked={selectedRunIds.size === runs.length && runs.length > 0}
              onChange={toggleAllRuns}
              className="h-4 w-4 rounded border-sdm-border text-sdm-accent focus:ring-sdm-accent"
            />
            <FolderOpen className="h-5 w-5 text-sdm-muted shrink-0" />
            <h2 className="text-lg font-semibold text-sdm-heading">Model runs</h2>
            <span className="text-sm text-sdm-muted">{runs.length} run{runs.length !== 1 ? "s" : ""}</span>
          </div>
          <p className="text-sm text-sdm-muted mt-1 ml-7">
            Select runs to delete — removes outputs and frees disk space.
          </p>
        </div>
        {selectedRunIds.size > 0 && (
          <div className="flex items-center justify-between px-6 py-2.5 bg-sdm-danger/5 border-b border-sdm-danger/20">
            <span className="text-sm font-medium text-sdm-danger">{selectedRunIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBatchConfirm("run")}
                disabled={batchDeleting}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white bg-sdm-danger hover:bg-sdm-danger disabled:opacity-50"
              >
                {batchDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {batchDeleting ? "Deleting..." : "Delete selected"}
              </button>
              <button
                onClick={() => setSelectedRunIds(new Set())}
                disabled={batchDeleting}
                className="inline-flex items-center gap-1 text-xs text-sdm-muted hover:text-sdm-text disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
          </div>
        )}
        {runs.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-sdm-muted">No completed or failed runs available for deletion.</div>
        ) : (
          <div className="divide-y divide-sdm-border">
            {runs.map((run) => {
              const checked = selectedRunIds.has(run.id);
              return (
                <div
                  key={run.id}
                  className={`flex items-center gap-3 px-6 py-3 transition-colors ${checked ? "bg-sdm-accent/[0.03]" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRunSelected(run.id)}
                    className="h-4 w-4 rounded border-sdm-border text-sdm-accent focus:ring-sdm-accent shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-sdm-text truncate">{run.species || "Unknown species"}</p>
                    <p className="text-xs text-sdm-muted">
                      {run.model_id} · status: {run.status}
                      {` · ${new Date(run.started_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={batchConfirm !== null}
        title={batchConfirm === "file" ? "Delete files" : "Delete runs"}
        message={
          batchConfirm === "file"
            ? `Delete ${selectedFileIds.size} uploaded file(s)? This cannot be undone.`
            : `Delete ${selectedRunIds.size} run(s) and all associated output files? This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="danger"
        loading={batchDeleting}
        onConfirm={batchConfirm === "file" ? batchDeleteFiles : batchDeleteRuns}
        onCancel={() => setBatchConfirm(null)}
      />
    </div>
  );
}
