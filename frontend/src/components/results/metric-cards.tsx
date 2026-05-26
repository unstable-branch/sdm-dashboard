function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface MetricCardsProps {
  metrics: Record<string, unknown>;
}

export function MetricCards({ metrics }: MetricCardsProps) {
  const cards = [
    { label: "AUC (mean)", value: num(metrics.auc_mean)?.toFixed(3) ?? "—", accent: "text-sdm-accent" },
    { label: "AUC (SD)", value: num(metrics.auc_sd)?.toFixed(3) ?? "—", accent: "text-sdm-muted" },
    { label: "TSS (mean)", value: num(metrics.tss_mean)?.toFixed(3) ?? "—", accent: "text-sdm-accent" },
    { label: "TSS (SD)", value: num(metrics.tss_sd)?.toFixed(3) ?? "—", accent: "text-sdm-muted" },
    { label: "Presence records", value: num(metrics.presence_records)?.toLocaleString() ?? "—", accent: "text-sdm-heading" },
    { label: "Background points", value: num(metrics.background_points)?.toLocaleString() ?? "—", accent: "text-sdm-heading" },
    { label: "High-suitability area", value: num(metrics.high_suitability_area_km2) ? `${num(metrics.high_suitability_area_km2)!.toLocaleString()} km²` : "—", accent: "text-sdm-heading" },
    { label: "Elapsed time", value: num(metrics.elapsed_seconds) ? `${Math.round(num(metrics.elapsed_seconds)!)}s` : "—", accent: "text-sdm-heading" },
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
