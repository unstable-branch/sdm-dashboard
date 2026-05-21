"use client";

import { MetricCard } from "@/components/ecology/metric-card";
import { WelcomePanel } from "@/components/ecology/welcome-panel";
import dynamic from "next/dynamic";

const SuitabilityMap = dynamic(
  () => import("@/components/results/suitability-map").then((mod) => ({ default: mod.SuitabilityMap })),
  { ssr: false, loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div> }
);

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Records"
          value="&mdash;"
          description="Load occurrence data"
        />
        <MetricCard
          title="Model"
          value="&mdash;"
          description="No model run yet"
        />
        <MetricCard
          title="AUC"
          value="&mdash;"
          description="Run a model to see metrics"
        />
        <MetricCard
          title="High-suitability area"
          value="&mdash;"
          description="km&sup2; above threshold"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SuitabilityMap outputFiles={null} />
        </div>
        <div>
          <WelcomePanel />
        </div>
      </div>
    </div>
  );
}
