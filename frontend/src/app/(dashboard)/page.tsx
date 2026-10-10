"use client";

import Link from "next/link";
import { MetricCard } from "@/components/ecology/metric-card";

import dynamic from "next/dynamic";
import { useCompletedRuns, useRuns } from "@/hooks/use-runs";
import { toNum, fmtFixed, fmtLocale } from "@/lib/utils";
import { Loader2, ArrowRight, Ban, Database, Brain, BarChart3, Clock, CheckCircle, XCircle } from "lucide-react";

const SuitabilityMap = dynamic(
  () => import("@/components/results/suitability-map"),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div> }
);

function EmptyWorkbenchPanel() {
  return (
    <section className="rounded-xl border border-sdm-border bg-sdm-surface p-6 sm:p-8" aria-labelledby="first-run-title">
      <p className="text-sm font-medium text-sdm-accent">Your first model run</p>
      <h2 id="first-run-title" className="mt-2 text-xl font-semibold text-sdm-heading">No completed runs yet</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-sdm-muted">
        Prepare occurrence records, choose your model and environmental layers, then review the resulting maps and diagnostics here.
        If you already have data in your workspace, continue from the Model page.
      </p>
      <p className="mt-4 text-sm text-sdm-muted">Need example data? The Data page includes a synthetic dataset generator.</p>
    </section>
  );
}

export default function DashboardPage() {
  const { data: completedRuns, isLoading, error: summaryError, refetch: retrySummary } = useCompletedRuns();
  const { data: runsData, isLoading: historyLoading, error: historyError, refetch: retryHistory } = useRuns();
  const latestRun = completedRuns.length > 0 ? completedRuns[0] : null;
  const recentRuns = (runsData?.runs ?? [])
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-sdm-accent">Dashboard overview</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-sdm-heading">Dashboard</h1>
          <p className="mt-2 text-sm leading-6 text-sdm-muted">Prepare data, follow your runs and return to the science.</p>
        </div>
        {latestRun && (
          <Link href={`/results/${latestRun.id}`} className="text-sm font-medium text-sdm-accent hover:underline">
            Open latest results
          </Link>
        )}
      </div>

      <nav aria-label="Workflow shortcuts" className="grid gap-3 md:grid-cols-3">
        {[
          { href: "/data", title: "Prepare occurrence data", description: "Upload, inspect and clean your records.", Icon: Database },
          { href: "/model", title: "Configure a model", description: "Choose an algorithm, layers and validation.", Icon: Brain },
          { href: "/results", title: "Review results", description: "Open run details, maps and diagnostics.", Icon: BarChart3 },
        ].map(({ href, title, description, Icon }, index) => (
          <Link key={href} href={href} className="group rounded-xl border border-sdm-border bg-sdm-surface p-5 transition-colors hover:border-sdm-accent focus-visible:outline-2 focus-visible:outline-sdm-accent">
            <div className="flex items-center justify-between">
              <Icon aria-hidden="true" className="h-5 w-5 text-sdm-accent" />
              <span className="text-xs font-medium text-sdm-muted">0{index + 1}</span>
            </div>
            <p className="mt-4 flex items-center justify-between gap-2 text-base font-semibold text-sdm-heading">{title}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-sdm-muted group-hover:text-sdm-accent" /></p>
            <p className="mt-2 text-sm leading-6 text-sdm-muted">{description}</p>
          </Link>
        ))}
      </nav>

      {isLoading && <p role="status" className="flex items-center gap-2 text-sm text-sdm-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading completed-run summary…</p>}
      {summaryError && (
        <div role="alert" className="rounded-xl border border-sdm-danger/30 bg-sdm-surface p-5">
          <p className="font-medium text-sdm-heading">Completed-run summary could not be loaded.</p>
          <p className="mt-1 text-sm text-sdm-muted">{latestRun ? "Showing the last available summary; it may be out of date." : "We cannot confirm whether you have completed runs. Your data and workflow pages remain available."}</p>
          <button type="button" onClick={() => retrySummary()} className="mt-3 rounded-md border border-sdm-border px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft">Retry summary</button>
        </div>
      )}

      {latestRun && <section aria-label="Completed run summary" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-sdm-heading">{summaryError ? "Last available completed run" : "Latest completed run"}</h2>
        <p className="mt-1 text-sm text-sdm-muted">{latestRun.species} · {latestRun.model_id}. Metrics below describe this run, not your whole workspace.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      </section>}

      {!latestRun && !isLoading && !summaryError && <EmptyWorkbenchPanel />}

      {historyLoading && <p role="status" className="flex items-center gap-2 text-sm text-sdm-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading recent runs…</p>}
      {historyError && (
        <div role="alert" className="rounded-xl border border-sdm-danger/30 bg-sdm-surface p-5">
          <p className="font-medium text-sdm-heading">Recent runs could not be loaded.</p>
          <p className="mt-1 text-sm text-sdm-muted">{recentRuns.length ? "Showing cached runs; statuses may be out of date." : "No reliable run history is available right now."}</p>
          <button type="button" onClick={() => retryHistory()} className="mt-3 rounded-md border border-sdm-border px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft">Retry recent runs</button>
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface">
          <div className="flex items-center justify-between border-b border-sdm-border px-4 py-3">
            <h2 className="text-lg font-semibold text-sdm-heading">Recent runs</h2>
            <Link href="/results" className="text-sm font-medium text-sdm-accent hover:underline">View all runs</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Recent runs">
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
                         run.status === "cancelled" ? <Ban className="h-3.5 w-3.5 inline mr-1" /> :
                         run.status === "running" || run.status === "loading" ? <Loader2 className="h-3.5 w-3.5 inline mr-1 animate-spin" /> :
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

      {latestRun && <section aria-label="Latest run suitability map" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-sdm-heading">Suitability map</h2>
          <Link href={`/results/${latestRun.id}`} className="text-sm font-medium text-sdm-accent hover:underline">Open run details and evaluation</Link>
        </div>
        <SuitabilityMap outputFiles={latestRun.output_files ?? null} runId={latestRun.id} />
      </section>}
    </div>
  );
}
