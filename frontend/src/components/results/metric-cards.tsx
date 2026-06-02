import { AlertTriangle, Info } from "lucide-react";
import { toNum, fmtFixed, fmtLocale } from "@/lib/utils";

function fmtArea(v: unknown): string {
  const n = toNum(v);
  return n !== null ? `${n.toLocaleString()} km²` : "—";
}

function fmtElapsed(v: unknown): string {
  const n = toNum(v);
  return n !== null ? `${Math.round(n)}s` : "—";
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
  const aucDiff = toNum(metrics.auc_diff);
  const trainingAuc = toNum(metrics.training_auc);
  const cvAuc = toNum(metrics.auc_mean);
  const cvCbi = toNum(metrics.cv_cbi);

  const showOverfitting = overfittingLevel && overfittingLevel !== "none" && overfittingLevel !== null;

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

  if (showOverfitting && aucDiff !== null) {
    cards.push({ label: "AUC gap (train - CV)", value: `+${fmtFixed(aucDiff, 3)}`, accent: "text-amber-500" });
  }

  if (trainingAuc !== null && trainingAuc !== undefined) {
    cards.push({ label: "Training AUC", value: fmtFixed(trainingAuc, 3), accent: "text-sdm-accent" });
  }

  if (cvCbi !== null && cvCbi !== undefined) {
    cards.push({ label: "CV CBI", value: fmtFixed(cvCbi, 3), accent: "text-sdm-muted" });
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
            <p className={`text-sm font-medium ${overfittingLevel === "high" ? "text-red-500" : "text-amber-500"}`}>
              {overfittingLevel === "high" ? "Overfitting detected" : "Mild overfitting"}
            </p>
            <p className="text-xs text-sdm-muted mt-0.5">
              Training AUC ({fmtFixed(trainingAuc, 3)}) exceeds CV AUC ({fmtFixed(cvAuc, 3)}) by {fmtFixed(aucDiff, 3)}.
            </p>
            <p className="text-xs text-sdm-muted mt-0.5">
              Suggestion: {overfittingSuggestion(modelId ?? null)}
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
    </div>
  );
}
