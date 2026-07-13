import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverfittingPanel } from "./overfitting-panel";
import type { RunDetail } from "@/services/types";

function run(metrics: Record<string, unknown>): RunDetail {
  return {
    id: "run-1",
    species: "Test species",
    model_id: "dnn",
    status: "completed",
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    metrics,
    output_files: null,
    progress_log: [],
    error: null,
  };
}

describe("OverfittingPanel", () => {
  it("does not claim overfitting or render gap arithmetic without comparable metrics", () => {
    render(<OverfittingPanel run={run({ overfitting_level: "low", training_auc: null, auc_mean: null })} />);

    expect(screen.queryByText(/Mild overfitting/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/training - CV/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Training metrics not available/i)).toBeInTheDocument();
  });

  it("recommends increasing DNN L2 regularisation when overfitting is supported", () => {
    render(<OverfittingPanel run={run({ overfitting_level: "medium", training_auc: 0.95, auc_mean: 0.8 })} />);

    expect(screen.getByText(/Mild overfitting/i)).toBeInTheDocument();
    expect(screen.getByText("Increase L2 lambda")).toBeInTheDocument();
    expect(screen.queryByText(/Reduce L2 lambda/i)).not.toBeInTheDocument();
    expect(screen.getByText("0.950 - 0.800 = +0.150")).toBeInTheDocument();
  });
});
