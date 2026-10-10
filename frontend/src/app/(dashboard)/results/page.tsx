"use client";

import Link from "next/link";
import { useState } from "react";
import { useRuns } from "@/hooks/use-runs";
import { CardSkeleton } from "@/components/ui/skeleton";
import { fmtFixed, fmtLocale } from "@/lib/utils";
import { BarChart3, ArrowRight, Ban, Clock, CheckCircle2, XCircle } from "lucide-react";

function runTiming(startedAt: string, completedAt: string | null): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "Start time unavailable";
  const finish = completedAt ? Date.parse(completedAt) : NaN;
  const duration = Number.isFinite(finish) && finish >= start ? ` · ${((finish - start) / 1000).toFixed(0)}s` : "";
  return new Date(start).toLocaleString() + duration;
}

export default function ResultsIndexPage() {
  const { data, isLoading, isFetching, error, refetch } = useRuns();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const allRuns = data?.runs ?? [];
  const searchTerm = search.trim().toLocaleLowerCase();
  const filteredRuns = allRuns.filter(run => (
    (!status || run.status === status) &&
    (!searchTerm || [run.species, run.model_id, run.id].some(value => value.toLocaleLowerCase().includes(searchTerm)))
  ));
  const statuses = Array.from(new Set(allRuns.map(run => run.status))).sort();
  function clearFilters() {
    setSearch("");
    setStatus("");
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-sdm-accent">Run history and outputs</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-sdm-heading">Results</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-sdm-muted">Follow model runs and open their maps, metrics and diagnostics. A run's status does not establish scientific validity.</p>
        </div>
        <Link href="/model" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-sdm-border bg-sdm-surface px-4 py-2.5 text-sm font-medium text-sdm-text hover:border-sdm-accent focus-visible:outline-2 focus-visible:outline-sdm-accent">
          Configure a model <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>

      {isLoading && <div className="space-y-3">
        <p role="status" className="text-sm text-sdm-muted">Loading run history…</p>
        <div aria-hidden="true" className="space-y-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
      </div>}

      {error && <div role="alert" className="rounded-xl border border-sdm-danger/30 bg-sdm-surface p-5">
        <p className="font-medium text-sdm-heading">Run history could not be loaded.</p>
        <p className="mt-1 text-sm leading-6 text-sdm-muted">{allRuns.length ? "Showing cached runs; statuses may be out of date." : "We cannot confirm whether any model runs exist. Your data and configuration pages remain available."}</p>
        <button type="button" onClick={() => refetch()} className="mt-3 rounded-md border border-sdm-border px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft focus-visible:outline-2 focus-visible:outline-sdm-accent">Retry run history</button>
      </div>}

      {!isLoading && !error && allRuns.length === 0 && <section aria-labelledby="empty-results-title" className="rounded-xl border border-sdm-border bg-sdm-surface p-6 sm:p-8">
        <BarChart3 aria-hidden="true" className="h-6 w-6 text-sdm-accent" />
        <h2 id="empty-results-title" className="mt-4 text-xl font-semibold text-sdm-heading">No model runs yet</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-sdm-muted">Configure a model with your occurrence records and environmental layers. Completed outputs and diagnostics will appear here; queued, running and unsuccessful runs are listed too.</p>
        <Link href="/data" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sdm-accent hover:underline focus-visible:outline-2 focus-visible:outline-sdm-accent">Prepare occurrence data <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
      </section>}

      {allRuns.length > 0 && <section aria-label="Browse run history" className="space-y-4">
        <div className="rounded-xl border border-sdm-border bg-sdm-surface p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]">
            <label className="space-y-2 text-sm font-medium text-sdm-text">
              <span>Search runs</span>
              <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Species, model or run ID" className="block min-h-11 w-full rounded-lg border border-sdm-border bg-sdm-surface-soft px-3 font-normal text-sdm-text placeholder:text-sdm-muted focus-visible:outline-2 focus-visible:outline-sdm-accent" />
            </label>
            <label className="space-y-2 text-sm font-medium text-sdm-text">
              <span>Run status</span>
              <select value={status} onChange={event => setStatus(event.target.value)} className="block min-h-11 w-full rounded-lg border border-sdm-border bg-sdm-surface-soft px-3 font-normal text-sdm-text focus-visible:outline-2 focus-visible:outline-sdm-accent">
                <option value="">All statuses</option>
                {Array.from(new Set([...statuses, ...(status ? [status] : [])])).map(value => <option key={value} value={value}>{value || "Unspecified"}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-sdm-muted">Showing {filteredRuns.length} of {allRuns.length} loaded runs.{isFetching && " Updating run history…"}</p>
            {(search || status) && <button type="button" onClick={clearFilters} className="rounded-md border border-sdm-border px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft focus-visible:outline-2 focus-visible:outline-sdm-accent">Clear filters</button>}
          </div>
        </div>
        {filteredRuns.length === 0 ? <div className="rounded-xl border border-sdm-border bg-sdm-surface p-6">
          <h2 className="text-lg font-semibold text-sdm-heading">No runs match these filters</h2>
          <p className="mt-2 text-sm leading-6 text-sdm-muted">Try another species, model or run ID, or clear the filters to return to the loaded history.</p>
        </div> : <ul aria-label="Run history" className="space-y-3">
        {filteredRuns.map((run) => (
          <li
            key={run.id}
            className="rounded-xl border border-sdm-border bg-sdm-surface p-5 sm:p-6"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {run.status === "completed" ? (
                  <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-sdm-success shrink-0" />
                ) : run.status === "failed" ? (
                  <XCircle aria-hidden="true" className="h-5 w-5 text-sdm-danger shrink-0" />
                ) : run.status === "cancelled" ? (
                  <Ban aria-hidden="true" className="h-5 w-5 text-sdm-warning shrink-0" />
                ) : (
                  <Clock aria-hidden="true" className="h-5 w-5 text-sdm-muted shrink-0" />
                )}
                <div className="min-w-0">
                  <h2 className="break-words text-base font-semibold text-sdm-heading"><Link href={`/results/${run.id}`} className="text-sdm-heading hover:text-sdm-accent hover:underline focus-visible:outline-2 focus-visible:outline-sdm-accent">{run.species || "Unnamed run"}</Link></h2>
                  <p className="mt-1 break-words text-sm leading-6 text-sdm-muted">
                    {run.model_id} · {runTiming(run.started_at, run.completed_at)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  run.status === "completed" ? "bg-sdm-success/10 text-sdm-success" :
                  run.status === "failed" ? "bg-sdm-danger/10 text-sdm-danger" :
                  run.status === "cancelled" ? "bg-sdm-warning/10 text-sdm-warning" : "bg-sdm-surface-soft text-sdm-muted"
                }`}>
                  {run.status}
                </span>
                {typeof run.error_code === "string" && run.error_code && (
                  <span className="break-all rounded-md border border-sdm-danger/30 bg-sdm-danger/10 px-2 py-1 text-xs font-medium text-sdm-danger">
                    {run.error_code}
                  </span>
                )}

              </div>
            </div>
            {run.metrics && (
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-sdm-border pt-3 text-sm text-sdm-muted">
                {run.metrics.auc_mean != null && <span>AUC: {fmtFixed(run.metrics.auc_mean, 3)}</span>}
                {run.metrics.tss_mean != null && <span>TSS: {fmtFixed(run.metrics.tss_mean, 3)}</span>}
                {run.metrics.presence_records != null && <span>Records: {fmtLocale(run.metrics.presence_records)}</span>}
              </div>
            )}
            {(run.error || run.error_hint) && (
              <div className="mt-4 space-y-1 rounded-lg border border-sdm-danger/20 p-3 text-sm leading-6">
                {run.error && <p className="break-words text-sdm-danger">{run.error}</p>}
                {run.error_hint && <p className="break-words text-sdm-muted">{run.error_hint}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>}
      </section>}
    </div>
  );
}
