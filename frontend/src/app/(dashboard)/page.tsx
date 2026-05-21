"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MetricCard } from "@/components/ecology/metric-card";
import { WelcomePanel } from "@/components/ecology/welcome-panel";
import dynamic from "next/dynamic";
import { Loader2, ArrowRight, Database, Brain, BarChart3 } from "lucide-react";

const SuitabilityMap = dynamic(
  () => import("@/components/results/suitability-map").then((mod) => ({ default: mod.SuitabilityMap })),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div> }
);

interface RunSummary {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  metrics: Record<string, number | null> | null;
  output_files: Record<string, string> | null;
}

export default function DashboardPage() {
  const [latestRun, setLatestRun] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/sdm/runs")
      .then((res) => res.json())
      .then((data) => {
        const completed = Array.isArray(data) ? data.filter((r: RunSummary) => r.status === "completed") : [];
        if (completed.length > 0) {
          setLatestRun(completed[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Records"
          value={latestRun ? (latestRun.metrics?.presence_records?.toLocaleString() ?? "—") : "—"}
          description={latestRun ? "Latest run" : "Load occurrence data"}
        />
        <MetricCard
          title="Model"
          value={latestRun?.model_id ?? "—"}
          description={latestRun ? latestRun.species : "No model run yet"}
        />
        <MetricCard
          title="AUC"
          value={latestRun?.metrics?.auc_mean ? (latestRun.metrics.auc_mean as number).toFixed(3) : "—"}
          description={latestRun ? `SD ±${(latestRun.metrics?.auc_sd ?? 0).toFixed(3)}` : "Run a model to see metrics"}
        />
        <MetricCard
          title="High-suitability area"
          value={latestRun?.metrics?.high_suitability_area_km2 ? `${Math.round(latestRun.metrics.high_suitability_area_km2 as number).toLocaleString()} km²` : "—"}
          description="km² above threshold"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SuitabilityMap outputFiles={latestRun?.output_files ?? null} />
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
