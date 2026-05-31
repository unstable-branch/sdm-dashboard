"use client";

import { AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { toNum, fmtFixed } from "@/lib/utils";
import type { RunDetail } from "@/services/types";

interface OverfittingPanelProps {
  run: RunDetail;
}

const OVERFITTING_SUGGESTIONS: Record<string, string[]> = {
  glm: ["Disable quadratic terms", "Reduce the number of predictors", "Use spatial-block CV for more conservative evaluation"],
  gam: ["Reduce k (basis dimension) for smoother response curves", "Use fewer covariates"],
  maxnet: ["Increase the regularization multiplier (try 1.5–3.0)", "Simplify feature classes (e.g. use lq instead of lqp)", "Enable auto-tune for grid search"],
  rf: ["Increase min_node_size (try 20–50)", "Reduce num_trees", "Reduce mtry for more regularization"],
  xgboost: ["Reduce max_depth (try 3–4)", "Increase learning rate (eta) and nrounds together", "Add early stopping rounds"],
  rangebag: ["Reduce bag_fraction (try 0.3)", "Reduce vars_per_bag (try 1–2)", "Increase n_bags for more stable ensemble"],
  dnn: ["Increase dropout rate (try 0.4–0.5)", "Reduce L2 lambda", "Switch to smaller architecture"],
};

function getSuggestions(modelId: string | null): string[] {
  if (!modelId) return ["Try a simpler model or increase regularization."];
  const id = modelId.toLowerCase();
  for (const [key, suggestions] of Object.entries(OVERFITTING_SUGGESTIONS)) {
    if (id.includes(key)) return suggestions;
  }
  return ["Try increasing regularization or simplifying the model."];
}

export function OverfittingPanel({ run }: OverfittingPanelProps) {
  const m = run.metrics || {};
  const overfittingLevel = (m.overfitting_level as string) || null;
  const aucDiff = toNum(m.auc_diff);
  const trainingAuc = toNum(m.training_auc);
  const cvAuc = toNum(m.auc_mean);
  const cvCbi = toNum(m.cv_cbi);
  const trainingCbiVal = toNum(m.cbi);
  const cbiDiff = toNum(m.cbi_diff);
  const messPct = m.mess_pct_extrapolation as number | undefined;

  const indicators: { label: string; value: string; status: "ok" | "warn" | "error" | "neutral" }[] = [];

  // AUC gap
  if (trainingAuc !== null && cvAuc !== null && aucDiff !== null) {
    indicators.push({
      label: "AUC gap (training - CV)",
      value: `${fmtFixed(trainingAuc, 3)} - ${fmtFixed(cvAuc, 3)} = +${fmtFixed(aucDiff, 3)}`,
      status: overfittingLevel === "high" ? "error" : overfittingLevel === "medium" ? "warn" : "ok",
    });
  } else if (trainingAuc !== null) {
    indicators.push({
      label: "Training AUC",
      value: fmtFixed(trainingAuc, 3),
      status: "neutral",
    });
  }

  // CBI gap
  if (trainingCbiVal !== null && cvCbi !== null && cbiDiff !== null) {
    indicators.push({
      label: "CBI gap (training - CV)",
      value: `${fmtFixed(trainingCbiVal, 3)} - ${fmtFixed(cvCbi, 3)} = ${cbiDiff >= 0 ? "+" : ""}${fmtFixed(cbiDiff, 3)}`,
      status: cbiDiff > 0.1 ? "error" : cbiDiff > 0.05 ? "warn" : "ok",
    });
  }

  // MESS extrapolation
  if (messPct !== undefined) {
    indicators.push({
      label: "MESS extrapolation",
      value: `${messPct.toFixed(1)}% of projection area`,
      status: messPct > 20 ? "error" : messPct > 10 ? "warn" : "ok",
    });
  }

  const hasData = indicators.length > 0;
  const showWarning = overfittingLevel && overfittingLevel !== "none";

  return (
    <div className="space-y-4">
      {showWarning && (
        <div
          className={`rounded-md border px-4 py-3 flex items-start gap-3 ${
            overfittingLevel === "high"
              ? "border-red-500/30 bg-red-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          {overfittingLevel === "high" ? (
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          ) : (
            <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div>
            <p className={`text-sm font-medium ${overfittingLevel === "high" ? "text-red-500" : "text-amber-500"}`}>
              {overfittingLevel === "high" ? "Overfitting detected" : "Mild overfitting — review suggestions below"}
            </p>
            <p className="text-xs text-sdm-muted mt-0.5">
              Model performs substantially better on training data than on cross-validated holdouts.
              Predictions may not generalise well to new areas.
            </p>
          </div>
        </div>
      )}

      {!hasData && overfittingLevel === "none" && (
        <div className="rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 flex items-start gap-3">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-500">No overfitting detected</p>
            <p className="text-xs text-sdm-muted mt-0.5">
              Training and CV performance are consistent — the model should generalise well.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Overfitting indicators</h4>
        {indicators.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {indicators.map((ind) => (
              <div
                key={ind.label}
                className={`rounded-md border px-3 py-2 ${
                  ind.status === "error"
                    ? "border-red-500/30 bg-red-500/5"
                    : ind.status === "warn"
                      ? "border-amber-500/30 bg-amber-500/5"
                      : ind.status === "ok"
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-sdm-border bg-sdm-surface-soft"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {ind.status === "error" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                  {ind.status === "warn" && <Info className="h-3 w-3 text-amber-500" />}
                  {ind.status === "ok" && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                  <p className="text-xs text-sdm-muted">{ind.label}</p>
                </div>
                <p className="mt-0.5 text-sm font-semibold text-sdm-text tabular-nums">{ind.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-sdm-muted italic">Training metrics not available for this model type.</p>
        )}
      </div>

      {showWarning && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h4 className="text-xs font-semibold text-sdm-heading mb-3 uppercase tracking-wide">Suggestions</h4>
          <ul className="space-y-1.5">
            {getSuggestions(run.model_id ?? null).map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-sdm-text">
                <span className="text-sdm-accent mt-0.5 shrink-0">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
