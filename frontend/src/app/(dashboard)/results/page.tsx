"use client";

import Link from "next/link";
import { useRuns } from "@/hooks/use-runs";
import { CardSkeleton } from "@/components/ui/skeleton";
import { fmtFixed, fmtLocale } from "@/lib/utils";
import { BarChart3, ArrowRight, Ban, Clock, CheckCircle2, XCircle } from "lucide-react";

export default function ResultsIndexPage() {
  const { data, isLoading, error, refetch } = useRuns();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Results</h1>
        <p className="text-sdm-muted">Browse completed model runs.</p>
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Results</h1>
        <div className="rounded-lg border border-red-300/30 bg-red-500/5 p-8 text-center">
          <p className="text-sm text-sdm-danger">{error.message}</p>
          <button onClick={() => refetch()} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs text-sdm-text hover:bg-sdm-surface">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const allRuns = data?.runs || [];

  if (allRuns.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Results</h1>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-12 text-center">
          <BarChart3 className="h-12 w-12 text-sdm-muted mx-auto mb-4" />
          <p className="text-sdm-muted">No model runs yet. Run a model from the Model page to see results.</p>
          <Link href="/model" className="mt-4 inline-flex items-center gap-1.5 text-sm text-sdm-accent hover:underline">
            Go to Model <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Results</h1>
        <p className="text-sdm-muted mt-1">Browse and compare completed model runs.</p>
      </div>

      <div className="space-y-3">
        {allRuns.map((run) => (
          <Link
            key={run.id}
            href={`/results/${run.id}`}
            className="block rounded-lg border border-sdm-border bg-sdm-surface p-4 hover:bg-sdm-surface-soft transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {run.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 text-sdm-success shrink-0" />
                ) : run.status === "failed" ? (
                  <XCircle className="h-5 w-5 text-sdm-danger shrink-0" />
                ) : run.status === "cancelled" ? (
                  <Ban className="h-5 w-5 text-sdm-warning shrink-0" />
                ) : (
                  <Clock className="h-5 w-5 text-sdm-accent shrink-0 animate-pulse" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-sdm-text truncate">{run.species || "Unnamed run"}</p>
                  <p className="text-xs text-sdm-muted">
                    {run.model_id} &middot; {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                    {run.completed_at && run.started_at && ` &middot; ${((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(0)}s`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  run.status === "completed" ? "bg-sdm-success/10 text-sdm-success" :
                  run.status === "failed" ? "bg-sdm-danger/10 text-sdm-danger" :
                  "bg-sdm-accent/10 text-sdm-accent"
                }`}>
                  {run.status}
                </span>
                {typeof run.error_code === "string" && run.error_code && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sdm-danger/10 text-sdm-danger border border-sdm-danger/30" title={typeof run.error_hint === "string" ? run.error_hint : ""}>
                    {run.error_code}
                  </span>
                )}
                <ArrowRight className="h-4 w-4 text-sdm-muted" />
              </div>
            </div>
            {run.metrics && (
              <div className="mt-2 flex gap-4 text-xs text-sdm-muted">
                {run.metrics.auc_mean != null && <span>AUC: {fmtFixed(run.metrics.auc_mean, 3)}</span>}
                {run.metrics.tss_mean != null && <span>TSS: {fmtFixed(run.metrics.tss_mean, 3)}</span>}
                {run.metrics.presence_records != null && <span>Records: {fmtLocale(run.metrics.presence_records)}</span>}
              </div>
            )}
            {run.error && (
              <div className="mt-2 text-xs text-sdm-muted">
                <span className="text-sdm-danger">{run.error}</span>
                {run.error_hint && <span className="ml-2 text-sdm-muted italic">— {run.error_hint}</span>}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
