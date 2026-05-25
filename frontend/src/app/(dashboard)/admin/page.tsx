"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost } from "@/services/api";
import { Users, BarChart3, Database, Zap, RefreshCw, Trash2, Loader2, Activity, Upload, Leaf, Play, CheckCircle2, XCircle, Clock } from "lucide-react";

interface OverviewData {
  counts: {
    users: number;
    runs: number;
    occurrences: number;
    species: number;
    projects: number;
    activeRuns: number;
  };
  uploadsByUser: Array<{
    userId: string | null;
    userName: string;
    count: number;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entity: string | null;
    createdAt: string;
    details: Record<string, unknown> | null;
  }>;
  recentRuns: Array<{
    id: string;
    speciesName: string | null;
    modelId: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    cpuTimeMs: number | null;
    peakMemoryMb: number | null;
  }>;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<OverviewData>("/api/v1/admin/overview");
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function clearCache() {
    setClearingCache(true);
    setCacheMsg(null);
    try {
      const res = await apiPost<{ message: string }>("/api/v1/admin/system/cache/clear");
      setCacheMsg(res.message);
      setTimeout(() => setCacheMsg(null), 3000);
    } catch (err) {
      setCacheMsg("Failed: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setClearingCache(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-400">{error}</div>
    );
  }

  if (!data) return null;

  const metrics = [
    { label: "Users", value: data.counts.users, icon: Users, color: "text-sdm-accent" },
    { label: "Total Runs", value: data.counts.runs, icon: BarChart3, color: "text-sdm-accent-blue" },
    { label: "Active Runs", value: data.counts.activeRuns, icon: Zap, color: "text-sdm-warning" },
    { label: "Projects", value: data.counts.projects, icon: Database, color: "text-sdm-accent-2" },
    { label: "Species", value: data.counts.species, icon: Leaf, color: "text-sdm-accent" },
    { label: "Occurrences", value: data.counts.occurrences, icon: Upload, color: "text-sdm-accent-blue" },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-sdm-heading">Admin Overview</h1>
        <div className="flex gap-2">
          <button onClick={fetchData}
            className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface-soft">
            <RefreshCw className="h-3.5 w-3.5 inline mr-1" /> Refresh
          </button>
          <button onClick={clearCache} disabled={clearingCache}
            className="rounded-md bg-sdm-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5 inline mr-1" />
            {clearingCache ? "Clearing..." : "Clear Cache"}
          </button>
        </div>
      </div>

      {cacheMsg && (
        <div className="rounded-md bg-sdm-success/10 border border-sdm-success/30 p-3 text-sm text-sdm-success">{cacheMsg}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <div className="flex items-center gap-2 mb-2">
              <m.icon className={`h-5 w-5 ${m.color}`} />
              <span className="text-xs text-sdm-muted">{m.label}</span>
            </div>
            <p className="text-2xl font-bold text-sdm-heading">{m.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {data.uploadsByUser.length > 0 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
          <div className="flex items-center gap-2 mb-4">
            <Upload className="h-5 w-5 text-sdm-accent" />
            <h2 className="text-lg font-medium text-sdm-heading">Uploads by User</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sdm-border">
                  <th className="text-left py-2 px-3 text-xs font-medium text-sdm-muted uppercase">User</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Uploads</th>
                </tr>
              </thead>
              <tbody>
                {data.uploadsByUser.map((u) => (
                  <tr key={u.userId || "unknown"} className="border-b border-sdm-border/50 last:border-0">
                    <td className="py-2 px-3 text-sdm-text">{u.userName}</td>
                    <td className="py-2 px-3 text-right font-medium text-sdm-heading">{u.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Play className="h-5 w-5 text-sdm-accent" />
          <h2 className="text-lg font-medium text-sdm-heading">Recent Runs</h2>
        </div>
        {data.recentRuns.length === 0 ? (
          <p className="text-sm text-sdm-muted">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sdm-border">
                  <th className="text-left py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Species</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Model</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Started</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Completed</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-sdm-muted uppercase">CPU</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-sdm-muted uppercase">Memory</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-sdm-border/50 hover:bg-sdm-surface-soft">
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                        r.status === "completed" ? "text-green-500" :
                        r.status === "failed" ? "text-red-400" :
                        r.status === "running" ? "text-blue-400" :
                        "text-sdm-muted"
                      }`}>
                        {r.status === "completed" ? <CheckCircle2 className="h-3 w-3" /> :
                         r.status === "failed" ? <XCircle className="h-3 w-3" /> :
                         r.status === "running" ? <Play className="h-3 w-3 animate-pulse" /> :
                         <Clock className="h-3 w-3" />}
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-sdm-text font-mono text-xs">{r.speciesName || "-"}</td>
                    <td className="py-2 px-3 text-sdm-muted text-xs">{r.modelId || "-"}</td>
                    <td className="py-2 px-3 text-sdm-muted text-xs whitespace-nowrap">
                      {r.startedAt ? new Date(r.startedAt).toLocaleString() : "-"}
                    </td>
                    <td className="py-2 px-3 text-sdm-muted text-xs whitespace-nowrap">
                      {r.completedAt ? new Date(r.completedAt).toLocaleString() : "-"}
                    </td>
                    <td className="py-2 px-3 text-right text-xs font-mono tabular-nums text-sdm-muted">
                      {r.cpuTimeMs != null ? `${(r.cpuTimeMs / 1000).toFixed(1)}s` : "-"}
                    </td>
                    <td className="py-2 px-3 text-right text-xs font-mono tabular-nums text-sdm-muted">
                      {r.peakMemoryMb != null ? `${r.peakMemoryMb} MB` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-sdm-accent" />
          <h2 className="text-lg font-medium text-sdm-heading">Recent Activity</h2>
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="text-sm text-sdm-muted">No activity yet.</p>
        ) : (
          <div className="space-y-2">
            {data.recentActivity.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-sdm-accent uppercase">{entry.action}</span>
                  {entry.entity && <span className="text-xs text-sdm-muted">- {entry.entity}</span>}
                </div>
                <span className="text-xs text-sdm-muted shrink-0">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
