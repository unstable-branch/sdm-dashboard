interface MetricCardsProps {
  metrics: Record<string, unknown>;
}

export function MetricCards({ metrics }: MetricCardsProps) {
  const cards = [
    { label: "AUC (mean)", value: (metrics.auc_mean as number)?.toFixed(3) ?? "—", accent: "text-sdm-accent" },
    { label: "AUC (SD)", value: (metrics.auc_sd as number)?.toFixed(3) ?? "—", accent: "text-sdm-muted" },
    { label: "TSS (mean)", value: (metrics.tss_mean as number)?.toFixed(3) ?? "—", accent: "text-sdm-accent" },
    { label: "TSS (SD)", value: (metrics.tss_sd as number)?.toFixed(3) ?? "—", accent: "text-sdm-muted" },
    { label: "Presence records", value: (metrics.presence_records as number)?.toLocaleString() ?? "—", accent: "text-sdm-heading" },
    { label: "Background points", value: (metrics.background_points as number)?.toLocaleString() ?? "—", accent: "text-sdm-heading" },
    { label: "High-suitability area", value: (metrics.high_suitability_area_km2 as number) ? `${(metrics.high_suitability_area_km2 as number).toLocaleString()} km²` : "—", accent: "text-sdm-heading" },
    { label: "Elapsed time", value: (metrics.elapsed_seconds as number) ? `${Math.round(metrics.elapsed_seconds as number)}s` : "—", accent: "text-sdm-heading" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">{card.label}</p>
          <p className={`mt-1 text-xl font-bold ${card.accent}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}
