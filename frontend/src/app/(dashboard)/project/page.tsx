"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cloud, ArrowRight, Loader2 } from "lucide-react";
import { apiGet } from "@/services/api";

interface FutureScenario {
  id: string;
  type: string;
  gcm: string;
  ssp: string;
  period: string;
  file_count: number;
  size_bytes: number;
  is_averaged: boolean;
}

export default function ProjectPage() {
  const [scenarios, setScenarios] = useState<FutureScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ available_scenarios: FutureScenario[] }>("/api/v1/sdm/future/scenarios")
      .then((data) => {
        setScenarios(data.available_scenarios || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Future Projection</h1>
        <p className="text-sdm-muted">Project suitability under CMIP6 climate scenarios.</p>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
    );
  }

  if (scenarios.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Future Projection</h1>
        <p className="text-sdm-muted">Project suitability under CMIP6 climate scenarios.</p>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center">
          <Cloud className="h-10 w-10 text-sdm-muted mx-auto mb-3" />
          <p className="text-sm text-sdm-heading font-medium">No future climate scenarios available</p>
          <p className="text-xs text-sdm-muted mt-1 mb-4">
            Download CMIP6 scenarios from the Data tab to enable future projections.
          </p>
          <Link href="/data" className="inline-flex items-center gap-2 text-sm font-medium text-sdm-accent hover:underline">
            Go to Data tab <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-sdm-heading">Future Projection</h1>
      <p className="text-sdm-muted">Select a downloaded CMIP6 scenario to project suitability under future climate.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id === selected ? null : s.id)}
            className={`rounded-lg border p-4 text-left transition-colors ${
              selected === s.id
                ? "border-sdm-accent bg-sdm-accent/5"
                : "border-sdm-border bg-sdm-surface hover:border-sdm-accent/50"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${s.is_averaged ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"}`}>
                {s.is_averaged ? "Averaged" : "Single GCM"}
              </span>
              <span className="text-xs text-sdm-muted">{s.file_count} files</span>
            </div>
            <p className="text-sm font-medium text-sdm-heading">{s.gcm}</p>
            <p className="text-xs text-sdm-muted mt-0.5">{s.ssp} · {s.period}</p>
          </button>
        ))}
      </div>

      {selected && (() => {
        const sel = scenarios.find((s) => s.id === selected);
        return (
        <div className="rounded-lg border border-sdm-accent/50 bg-sdm-accent/5 p-4">
          <p className="text-sm text-sdm-heading font-medium">Selected: {sel?.gcm} / {sel?.ssp} / {sel?.period}</p>
          <p className="text-xs text-sdm-muted mt-1">
            Run a model with future projection enabled in the Model tab to use this scenario.
          </p>
          <Link href="/model" className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-sdm-accent hover:underline">
            Go to Model tab <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        );
      })()}
    </div>
  );
}
