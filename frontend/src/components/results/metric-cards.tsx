import { AlertTriangle, Info } from "lucide-react";

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatArea(v: number): string {
  if (v >= 1000) return `${Math.round(v).toLocaleString()} km²`;
  if (v >= 1) return `${v.toFixed(1)} km²`;
  return `${(v * 100).toFixed(1)} ha`;
}

const OVERFITTING_SUGGESTIONS: Record<string, string> = {
  glm: "Disable quadratic terms or reduce the number of predictors.",
  gam: "Reduce k (basis dimension) to create smoother response curves.",
  maxnet: "Increase the regularization multiplier or reduce feature classes (e.g. use lq instead of lqp).",
  rf: "Increase min_node_size or reduce num_trees.",
  xgboost: "Reduce max_depth, increase learning rate (eta), or add more boosting rounds with early stopping.",
  rangebag: "Reduce bag_fraction or vars_per_bag to increase regularization.",
  ensemble_glm_rangebag: "Reduce bag_fraction or vars_per_bag in the rangebag component.",
  dnn: "Increase dropout rate or reduce L2 lambda.",
};

function overfittingSuggestion(modelId: string | null): string {
  if (!modelId) return "Try a simpler model or increase regularization.";
  const id = modelId.toLowerCase();
  for (const [key, suggestion] of Object.entries(OVERFITTING_SUGGESTIONS)) {
    if (id.includes(key)) return suggestion;
  }
  return "Try increasing regularization or simplifying the model.";
}

interface MetricCardsProps {
  metrics: Record<string, unknown>;
  modelId?: string | null;
}

export function MetricCards({ metrics, modelId }: MetricCardsProps) {
  const overfittingLevel = metrics.overfitting_level as string | null;
  const aucDiff = num(metrics.auc_diff);

  const showOverfitting = overfittingLevel && overfittingLevel !== "none" && overfittingLevel !== null;

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

  const cards: { label: string; value: string; accent: string }[] = [
    { label: "AUC (mean)", value: num(metrics.auc_mean)?.toFixed(3) ?? "—", accent: "text-sdm-accent" },
    { label: "AUC (SD)", value: num(metrics.auc_sd)?.toFixed(3) ?? "—", accent: "text-sdm-muted" },
    { label: "TSS (mean)", value: num(metrics.tss_mean)?.toFixed(3) ?? "—", accent: "text-sdm-accent" },
    { label: "TSS (SD)", value: num(metrics.tss_sd)?.toFixed(3) ?? "—", accent: "text-sdm-muted" },
    { label: "Presence records", value: num(metrics.presence_records)?.toLocaleString() ?? "—", accent: "text-sdm-heading" },
    { label: "Background points", value: num(metrics.background_points)?.toLocaleString() ?? "—", accent: "text-sdm-heading" },
    { label: "Elapsed time", value: num(metrics.elapsed_seconds) ? `${Math.round(num(metrics.elapsed_seconds)!)}s` : "—", accent: "text-sdm-heading" },
  ];

  if (showOverfitting && aucDiff !== null) {
    cards.push({ label: "AUC gap (train - CV)", value: `+${aucDiff.toFixed(3)}`, accent: "text-amber-500" });
  }

  const trainingAuc = num(metrics.training_auc);
  if (trainingAuc !== null) {
    cards.push({ label: "Training AUC", value: trainingAuc.toFixed(3), accent: "text-sdm-accent" });
  }

  const cvCbi = num(metrics.cv_cbi);
  if (cvCbi !== null) {
    cards.push({ label: "CV CBI", value: cvCbi.toFixed(3), accent: "text-sdm-muted" });
  }

  return (
    <div className="space-y-4">
      {showOverfitting && (
        <div
          className={`rounded-md border px-4 py-3 flex items-start gap-3 ${
            overfittingLevel === "high"
              ? "border-red-500/30 bg-red-500/5"
              : overfittingLevel === "medium"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-blue-500/30 bg-blue-500/5"
          }`}
        >
          {overfittingLevel === "high" ? (
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          ) : (
            <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div>
            <p className={`text-sm font-medium ${
              overfittingLevel === "high" ? "text-red-500" : "text-amber-500"
            }`}>
              {overfittingLevel === "high" ? "High overfitting detected" :
               overfittingLevel === "medium" ? "Moderate overfitting detected" :
               "Slight overfitting detected"}
            </p>
            <p className="text-xs text-sdm-muted mt-0.5">
              Training AUC ({trainingAuc?.toFixed(3) ?? "?"}) exceeds CV AUC ({num(metrics.auc_mean)?.toFixed(3) ?? "?"})
              by {aucDiff?.toFixed(3) ?? "?"}. {overfittingSuggestion(modelId ?? (metrics.model_id as string))}
            </p>
          </div>
        </div>
      )}

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
