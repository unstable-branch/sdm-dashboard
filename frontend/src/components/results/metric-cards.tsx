function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatArea(v: number): string {
  if (v >= 1000) return `${Math.round(v).toLocaleString()} km²`;
  if (v >= 1) return `${v.toFixed(1)} km²`;
  return `${(v * 100).toFixed(1)} ha`;
}

interface MetricCardsProps {
  metrics: Record<string, unknown>;
}

export function MetricCards({ metrics }: MetricCardsProps) {
  const area = num(metrics.high_suitability_area_km2);
  const areaUncertainty = num(metrics.high_suitability_area_uncertainty_km2);
  const areaCi95Lower = num(metrics.high_suitability_area_ci95_lower);
  const areaCi95Upper = num(metrics.high_suitability_area_ci95_upper);

  const areaValue = area ? formatArea(area) : "—";
  const areaDetail = area && areaUncertainty
    ? `±${formatArea(areaUncertainty)}`
    : area && areaCi95Lower != null && areaCi95Upper != null
    ? `95% CI: ${formatArea(areaCi95Lower)} – ${formatArea(areaCi95Upper)}`
    : null;

  const cards = [
    { label: "AUC (mean)", value: num(metrics.auc_mean)?.toFixed(3) ?? "—", accent: "text-sdm-accent" as const },
    { label: "AUC (SD)", value: num(metrics.auc_sd)?.toFixed(3) ?? "—", accent: "text-sdm-muted" as const },
    { label: "TSS (mean)", value: num(metrics.tss_mean)?.toFixed(3) ?? "—", accent: "text-sdm-accent" as const },
    { label: "TSS (SD)", value: num(metrics.tss_sd)?.toFixed(3) ?? "—", accent: "text-sdm-muted" as const },
    { label: "Presence records", value: num(metrics.presence_records)?.toLocaleString() ?? "—", accent: "text-sdm-heading" as const },
    { label: "Background points", value: num(metrics.background_points)?.toLocaleString() ?? "—", accent: "text-sdm-heading" as const },
    { label: "Elapsed time", value: num(metrics.elapsed_seconds) ? `${Math.round(num(metrics.elapsed_seconds)!)}s` : "—", accent: "text-sdm-heading" as const },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">{card.label}</p>
            <p className={`mt-1 text-xl font-bold ${card.accent}`}>{card.value}</p>
          </div>
        ))}
      </div>
      {area != null && (
        <div className="rounded-lg border border-sdm-accent/30 bg-sdm-accent/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">High-suitability area</p>
          <p className="mt-1 text-2xl font-bold text-sdm-accent">{areaValue}</p>
          {areaDetail && (
            <p className="mt-0.5 text-xs text-sdm-muted">{areaDetail}</p>
          )}
        </div>
      )}
    </div>
  );
}
