"use client";

import Link from "next/link";
import { MetricCard } from "@/components/ecology/metric-card";
import { WelcomePanel } from "@/components/ecology/welcome-panel";
import dynamic from "next/dynamic";
import { useCompletedRuns, useRuns } from "@/hooks/use-runs";
import { toNum, fmtFixed, fmtLocale } from "@/lib/utils";
import { Loader2, ArrowRight, Database, Brain, BarChart3, Map, Upload, CheckCircle2, Circle, Clock, CheckCircle, XCircle } from "lucide-react";

const SuitabilityMap = dynamic(
  () => import("@/components/results/suitability-map").then((mod) => ({ default: mod.SuitabilityMap })),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div> }
);

function EmptyWorkbenchPanel() {
  const steps = [
    { label: "Data", href: "/data", complete: false },
    { label: "Model", href: "/model", complete: false },
    { label: "Evaluate", href: "/evaluate", complete: false },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-sdm-border bg-sdm-surface">
      <div className="flex items-center justify-between border-b border-sdm-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-sdm-heading">Workbench map</h2>
          <p className="text-xs text-sdm-muted">No completed model run yet</p>
        </div>
        <Map className="h-5 w-5 text-sdm-accent" />
      </div>
      <div className="min-h-[420px] bg-sdm-surface-soft p-4 sm:p-6">
        <div className="grid h-full min-h-[380px] place-items-center rounded-md border border-dashed border-sdm-border bg-sdm-surface">
          <div className="max-w-md space-y-5 px-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-sdm-accent/30 bg-sdm-accent/10">
              <Upload className="h-6 w-6 text-sdm-accent" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-sdm-heading">Start with occurrence data</h3>
              <p className="mt-1 text-sm text-sdm-muted">
                Upload a CSV, clean records, then run a small model to populate maps, metrics, downloads, and ecology summaries.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {steps.map((step) => (
                <Link
                  key={step.href}
                  href={step.href}
                  className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface px-3 py-1.5 text-xs font-medium text-sdm-text hover:border-sdm-accent/40 hover:text-sdm-accent"
                >
                  {step.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                  {step.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: completedRuns, isLoading } = useCompletedRuns();
  const { data: runsData } = useRuns();
  const latestRun = completedRuns.length > 0 ? completedRuns[0] : null;
  const recentRuns = (runsData?.runs ?? [])
    .filter((r) => r.status !== "running")
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sdm-heading">Dashboard</h1>
          <p className="text-sm text-sdm-muted">Current run state, maps, and next workflow actions.</p>
        </div>
        {latestRun && (
          <Link href={`/results/${latestRun.id}`} className="text-sm font-medium text-sdm-accent hover:underline">
            Open latest results
          </Link>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Records"
          value={latestRun ? fmtLocale(latestRun.metrics?.presence_records) : "—"}
          description={latestRun ? "Latest run" : "Load occurrence data"}
        />
        <MetricCard
          title="Model"
          value={latestRun?.model_id ?? "—"}
          description={latestRun ? latestRun.species : "No model run yet"}
        />
        <MetricCard
          title="AUC"
          value={fmtFixed(latestRun?.metrics?.auc_mean, 3)}
          description={latestRun ? `SD ±${fmtFixed(latestRun.metrics?.auc_sd, 3)}` : "Run a model to see metrics"}
        />
        <MetricCard
          title="High-suitability area"
          value={(() => { const n = toNum(latestRun?.metrics?.high_suitability_area_km2); return n !== null ? `${Math.round(n).toLocaleString()} km²` : "—"; })()}
          description="km² above threshold"
        />
      </div>

      {recentRuns.length > 0 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface">
          <div className="flex items-center justify-between border-b border-sdm-border px-4 py-3">
            <h2 className="text-sm font-semibold text-sdm-heading">Recent Runs</h2>
            <Link href="/model" className="text-xs font-medium text-sdm-accent hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sdm-border/50 text-xs text-sdm-muted">
                  <th className="px-4 py-2 text-left font-medium">Species</th>
                  <th className="px-4 py-2 text-left font-medium">Model</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-b border-sdm-border/30 last:border-0 hover:bg-sdm-surface-soft transition-colors">
                    <td className="px-4 py-2">
                      <Link href={`/results/${run.id}`} className="text-sdm-accent hover:underline">
                        {run.species}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-sdm-text">{run.model_id}</td>
                    <td className="px-4 py-2">
                      <span className={
                        run.status === "completed" ? "text-green-500" :
                        run.status === "failed" ? "text-red-500" :
                        run.status === "cancelled" ? "text-amber-500" :
                        "text-sdm-muted"
                      }>
                        {run.status === "completed" ? <CheckCircle className="h-3.5 w-3.5 inline mr-1" /> :
                         run.status === "failed" ? <XCircle className="h-3.5 w-3.5 inline mr-1" /> :
                         run.status === "cancelled" ? <XCircle className="h-3.5 w-3.5 inline mr-1" /> :
                         <Clock className="h-3.5 w-3.5 inline mr-1" />}
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sdm-muted">
                      {run.completed_at
                        ? new Date(run.completed_at).toLocaleDateString()
                        : run.started_at
                        ? new Date(run.started_at).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {latestRun ? (
            <SuitabilityMap outputFiles={latestRun.output_files ?? null} runId={latestRun.id} />
          ) : (
            <EmptyWorkbenchPanel />
          )}
        </div>
        <div className="space-y-4">
          <WelcomePanel />

          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-3">
            <h3 className="text-sm font-semibold text-sdm-heading">Quick actions</h3>
            <div className="space-y-2">
              <Link href="/data" className="flex items-center justify-between rounded-md bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface transition-colors group">
                <span className="flex items-center gap-2"><Database className="h-4 w-4 text-sdm-accent" /> Upload occurrence data</span>
                <ArrowRight className="h-3.5 w-3.5 text-sdm-muted group-hover:text-sdm-text transition-colors" />
              </Link>
              <Link href="/model" className="flex items-center justify-between rounded-md bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface transition-colors group">
                <span className="flex items-center gap-2"><Brain className="h-4 w-4 text-sdm-accent" /> Run SDM model</span>
                <ArrowRight className="h-3.5 w-3.5 text-sdm-muted group-hover:text-sdm-text transition-colors" />
              </Link>
              <Link href="/evaluate" className="flex items-center justify-between rounded-md bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface transition-colors group">
                <span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-sdm-accent" /> Evaluate results</span>
                <ArrowRight className="h-3.5 w-3.5 text-sdm-muted group-hover:text-sdm-text transition-colors" />
              </Link>
            </div>
          </div>

          {latestRun && (
            <Link href={`/results/${latestRun.id}`} className="block rounded-lg border border-sdm-accent/30 bg-sdm-accent/5 p-4 hover:bg-sdm-accent/10 transition-colors">
              <p className="text-sm font-medium text-sdm-accent">View latest results →</p>
              <p className="text-xs text-sdm-muted mt-1">{latestRun.species} · {latestRun.model_id}</p>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
