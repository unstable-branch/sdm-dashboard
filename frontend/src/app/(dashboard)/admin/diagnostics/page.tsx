"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { apiGet, apiPost } from "@/services/api";
import { Loader2, AlertCircle, CheckCircle2, Clock, XCircle, Play, RefreshCw, Upload, FileText, HardDrive, Search } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";

interface RunRecord {
  id: string;
  speciesName: string | null;
  modelId: string | null;
  status: string;
  jobId: string | null;
  bullmqId: string | null;
  runNumber: number | null;
  progressLog: any;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RunDetail {
  id: string;
  config: any;
  metrics: any;
  error: string | null;
}

interface UploadRecord {
  id: string;
  userId: string | null;
  userName: string;
  pipelineRunId: string | null;
  details: any;
  createdAt: string;
  recordCount: number;
  flaggedCount: number;
  runCount: number;
}

interface UploadsResponse {
  uploads: UploadRecord[];
  total: number;
  page: number;
  limit: number;
}

interface FileEntry {
  name: string;
  size: number;
  lastModified: string;
  isCleaned: boolean;
}

interface FilesystemResponse {
  files: FileEntry[];
  totalFiles: number;
  totalSize: number;
  rawCount: number;
  cleanedCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-400" />;
    case "running": return <Play className="h-4 w-4 text-blue-400 animate-pulse" />;
    case "queued": return <Clock className="h-4 w-4 text-yellow-500" />;
    default: return <AlertCircle className="h-4 w-4 text-sdm-muted" />;
  }
}

function RunsTab() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const limit = 25;

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const data = await apiGet<{ runs: RunRecord[]; total: number }>(`/api/v1/admin/diagnostics/runs?${params}`);
      setRuns(data.runs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  async function expandRun(id: string) {
    if (expandedRun === id) { setExpandedRun(null); setRunDetail(null); return; }
    setExpandedRun(id);
    setDetailLoading(true);
    try {
      const detail = await apiGet<RunDetail>(`/api/v1/admin/diagnostics/runs/${id}`);
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function cleanupJobs() {
    try {
      const res = await apiPost<{ message: string }>("/api/v1/admin/system/jobs/cleanup");
      alert(res.message);
      fetchRuns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  if (loading && runs.length === 0) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-sdm-heading">Model Runs</h2>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sdm-muted" />
            <input
              type="text"
              placeholder="Search species, model, job ID..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="rounded-md border border-sdm-border bg-sdm-surface pl-7 pr-2 py-1.5 text-xs text-sdm-text w-56"
            />
          </div>
          <button onClick={() => setStatusFilter("")} className={`rounded px-3 py-1 text-xs ${!statusFilter ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text"}`}>All</button>
          {["completed", "failed", "running", "queued", "cancelled"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded px-3 py-1 text-xs capitalize ${statusFilter === s ? "bg-sdm-accent text-white" : "border border-sdm-border text-sdm-text hover:bg-sdm-surface-soft"}`}>{s}</button>
          ))}
          <button onClick={cleanupJobs}
            className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft">
            <RefreshCw className="h-3.5 w-3.5 inline mr-1" /> Cleanup
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">{error}</div>}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-sdm-border bg-sdm-surface-soft">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Species</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Model</th>
              <th className="text-center px-2 py-3 text-xs font-medium text-sdm-muted">#</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Job ID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">BullMQ</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <Fragment key={r.id}>
                <tr onClick={() => expandRun(r.id)}
                  className="border-b border-sdm-border hover:bg-sdm-surface-soft cursor-pointer">
                  <td className="px-4 py-2"><div className="flex items-center gap-1"><StatusIcon status={r.status} /><span className="text-xs capitalize">{r.status}</span></div></td>
                  <td className="px-4 py-2 text-xs text-sdm-text">{r.speciesName || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{r.modelId || "-"}</td>
                  <td className="px-2 py-2 text-xs text-center text-sdm-muted font-mono">{r.runNumber != null ? `#${r.runNumber}` : "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{r.jobId || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono">{r.bullmqId || "-"}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
                {expandedRun === r.id && (
                  <tr key={`${r.id}-detail`} className="border-b border-sdm-border bg-sdm-surface-soft">
                    <td colSpan={7} className="px-4 py-3">
                      {detailLoading ? <Loader2 className="h-4 w-4 animate-spin text-sdm-accent" /> : runDetail ? (
                        <div className="space-y-2">
                          {r.progressLog && Array.isArray(r.progressLog) && r.progressLog.length > 0 && (
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <h4 className="text-xs font-medium text-sdm-muted">Progress stages</h4>
                                <CopyButton value={r.progressLog} label="Copy progress" />
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {r.progressLog.map((entry: any, i: number) => (
                                  <span key={i}
                                    className={`text-xs rounded px-1.5 py-0.5 ${
                                      entry.stage === "unknown" ? "bg-sdm-surface text-sdm-muted" :
                                      i === r.progressLog.length - 1 && r.status === "running"
                                        ? "bg-sdm-accent/15 text-sdm-accent animate-pulse"
                                        : "bg-sdm-accent/10 text-sdm-accent"
                                    }`}>
                                    {entry.stage}: {Math.round((entry.percent || 0) * 100)}%
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="text-xs font-medium text-sdm-muted">Config</h4>
                                <CopyButton value={runDetail.config} />
                              </div>
                              <pre className="text-xs text-sdm-text bg-sdm-surface rounded p-2 max-h-40 overflow-auto">{JSON.stringify(runDetail.config, null, 2)}</pre>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="text-xs font-medium text-sdm-muted">Metrics</h4>
                                <CopyButton value={runDetail.metrics} />
                              </div>
                              <pre className="text-xs text-sdm-text bg-sdm-surface rounded p-2 max-h-40 overflow-auto">{JSON.stringify(runDetail.metrics, null, 2)}</pre>
                            </div>
                          </div>
                          {runDetail.error && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="text-xs font-medium text-red-400">Error</h4>
                                <CopyButton value={runDetail.error} />
                              </div>
                              <pre className="text-xs text-red-400 bg-red-500/5 rounded p-2 max-h-32 overflow-auto">{runDetail.error}</pre>
                            </div>
                          )}
                          {r.error && runDetail.error !== r.error && (
                            <div>
                              <h4 className="text-xs font-medium text-red-400 mb-1">Run Error (DB)</h4>
                              <pre className="text-xs text-red-400 bg-red-500/5 rounded p-2">{r.error}</pre>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <CopyButton value={runDetail} label="Copy full diagnostics" />
                          </div>
                        </div>
                      ) : <span className="text-xs text-sdm-muted">No diagnostics available</span>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-sdm-muted">
        <span>{total} runs</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Previous</button>
          <button onClick={() => setPage(page + 1)} disabled={page * limit >= total}
            className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Next</button>
        </div>
      </div>
    </div>
  );
}

function UploadsTab() {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUpload, setExpandedUpload] = useState<string | null>(null);
  const [filesystem, setFilesystem] = useState<FilesystemResponse | null>(null);
  const [fsLoading, setFsLoading] = useState(true);
  const limit = 25;

  const fetchUploads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const data = await apiGet<UploadsResponse>(`/api/v1/admin/diagnostics/uploads?${params}`);
      setUploads(data.uploads);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load uploads");
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchFilesystem = useCallback(async () => {
    setFsLoading(true);
    try {
      const data = await apiGet<FilesystemResponse>("/api/v1/admin/diagnostics/filesystem");
      setFilesystem(data);
    } catch {
      // non-critical
    } finally {
      setFsLoading(false);
    }
  }, []);

  useEffect(() => { fetchUploads(); }, [fetchUploads]);
  useEffect(() => { fetchFilesystem(); }, [fetchFilesystem]);

  if (loading && uploads.length === 0) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Filesystem summary card */}
      {!fsLoading && filesystem && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="h-4 w-4 text-sdm-accent" />
            <h3 className="text-sm font-semibold text-sdm-heading">Uploads directory</h3>
          </div>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-sdm-muted">Total files</p>
              <p className="text-lg font-semibold text-sdm-text">{filesystem.totalFiles}</p>
            </div>
            <div>
              <p className="text-xs text-sdm-muted">Total size</p>
              <p className="text-lg font-semibold text-sdm-text">{formatBytes(filesystem.totalSize)}</p>
            </div>
            <div>
              <p className="text-xs text-sdm-muted">Raw uploads</p>
              <p className="text-lg font-semibold text-sdm-text">{filesystem.rawCount}</p>
            </div>
            <div>
              <p className="text-xs text-sdm-muted">Cleaned files</p>
              <p className="text-lg font-semibold text-sdm-text">{filesystem.cleanedCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* Uploads table */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-sdm-border bg-sdm-surface-soft">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">File</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">User</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-sdm-muted">Records</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-sdm-muted">Flagged</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-sdm-muted">Runs</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Pipeline ID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-sdm-muted">Date</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-sdm-muted w-16">Copy</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((u) => (
              <Fragment key={u.id}>
                <tr onClick={() => setExpandedUpload(expandedUpload === u.id ? null : u.id)}
                  className="border-b border-sdm-border hover:bg-sdm-surface-soft cursor-pointer">
                  <td className="px-4 py-2 text-xs text-sdm-text font-mono max-w-[200px] truncate">
                    {u.details?.filename || u.details?.source || "-"}
                  </td>
                  <td className="px-4 py-2 text-xs text-sdm-text">{u.userName}</td>
                  <td className="px-4 py-2 text-xs text-sdm-text text-right">{u.recordCount.toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs text-right">
                    <span className={u.flaggedCount > 0 ? "text-red-400" : "text-sdm-muted"}>
                      {u.flaggedCount.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-center text-sdm-muted">{u.runCount}</td>
                  <td className="px-4 py-2 text-xs text-sdm-muted font-mono max-w-[160px] truncate" title={u.pipelineRunId || ""}>
                    {u.pipelineRunId ? u.pipelineRunId.slice(0, 8) + "..." : "-"}
                  </td>
                  <td className="px-4 py-2 text-xs text-sdm-muted">{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <CopyButton value={u} onClick={(e) => e.stopPropagation()} />
                  </td>
                </tr>
                {expandedUpload === u.id && (
                  <tr className="border-b border-sdm-border bg-sdm-surface-soft">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="space-y-1 text-xs text-sdm-text">
                        <p><span className="text-sdm-muted">Pipeline ID:</span> {u.pipelineRunId || "-"}</p>
                        <p><span className="text-sdm-muted">Source:</span> {u.details?.source || "csv"}</p>
                        {u.details?.taxon && <p><span className="text-sdm-muted">Taxon:</span> {u.details.taxon}</p>}
                        {u.details?.country && <p><span className="text-sdm-muted">Country:</span> {u.details.country}</p>}
                        <p><span className="text-sdm-muted">File size:</span> {u.details?.fileSize ? formatBytes(u.details.fileSize) : "-"}</p>
                        {u.details && Object.keys(u.details).length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sdm-muted">Full details:</p>
                              <CopyButton value={u.details} label="Copy details" />
                            </div>
                            <pre className="bg-sdm-surface rounded p-2 max-h-32 overflow-auto text-xs">{JSON.stringify(u.details, null, 2)}</pre>
                          </div>
                        )}
                        <div className="flex gap-2 mt-2">
                          <CopyButton value={u} label="Copy full upload record" />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-sdm-muted">
        <span>{total} uploads</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Previous</button>
          <button onClick={() => setPage(page + 1)} disabled={page * limit >= total}
            className="rounded border border-sdm-border px-3 py-1 text-xs hover:bg-sdm-surface-soft disabled:opacity-30">Next</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminDiagnosticsPage() {
  const [activeTab, setActiveTab] = useState<"runs" | "uploads">("runs");

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold text-sdm-heading">Diagnostic Logs</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-sdm-border">
        <button
          onClick={() => setActiveTab("runs")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "runs"
              ? "border-sdm-accent text-sdm-accent"
              : "border-transparent text-sdm-muted hover:text-sdm-text"
          }`}
        >
          <Play className="h-3.5 w-3.5" />
          Runs
        </button>
        <button
          onClick={() => setActiveTab("uploads")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "uploads"
              ? "border-sdm-accent text-sdm-accent"
              : "border-transparent text-sdm-muted hover:text-sdm-text"
          }`}
        >
          <Upload className="h-3.5 w-3.5" />
          Uploads
        </button>
      </div>

      {activeTab === "runs" ? <RunsTab /> : <UploadsTab />}
    </div>
  );
}
