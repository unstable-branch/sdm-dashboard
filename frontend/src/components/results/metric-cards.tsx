function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? null : n;
}

function fmtFixed(v: unknown, d: number): string {
  const n = toNum(v);
  return n !== null ? n.toFixed(d) : "—";
}

function fmtLocale(v: unknown): string {
  const n = toNum(v);
  return n !== null ? n.toLocaleString() : "—";
}

function fmtArea(v: unknown): string {
  const n = toNum(v);
  return n !== null ? `${n.toLocaleString()} km²` : "—";
}

function fmtElapsed(v: unknown): string {
  const n = toNum(v);
  return n !== null ? `${Math.round(n)}s` : "—";
}

interface MetricCardsProps {
  metrics: Record<string, unknown>;
}

export function MetricCards({ metrics }: MetricCardsProps) {
  const cards = [
    { label: "AUC (mean)", value: fmtFixed(metrics.auc_mean, 3), accent: "text-sdm-accent" },
    { label: "AUC (SD)", value: fmtFixed(metrics.auc_sd, 3), accent: "text-sdm-muted" },
    { label: "TSS (mean)", value: fmtFixed(metrics.tss_mean, 3), accent: "text-sdm-accent" },
    { label: "TSS (SD)", value: fmtFixed(metrics.tss_sd, 3), accent: "text-sdm-muted" },
    { label: "Presence records", value: fmtLocale(metrics.presence_records), accent: "text-sdm-heading" },
    { label: "Background points", value: fmtLocale(metrics.background_points), accent: "text-sdm-heading" },
    { label: "High-suitability area", value: fmtArea(metrics.high_suitability_area_km2), accent: "text-sdm-heading" },
    { label: "Elapsed time", value: fmtElapsed(metrics.elapsed_seconds), accent: "text-sdm-heading" },
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
