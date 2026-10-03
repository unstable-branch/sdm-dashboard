import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@/services/types";
import ResultsIndexPage from "./page";

const query = vi.hoisted(() => ({
  data: { runs: [] as RunSummary[] } as { runs: RunSummary[] } | undefined,
  isLoading: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/use-runs", () => ({ useRuns: () => query }));

function run(id: string, status: string, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id, species: `Species ${id}`, model_id: "glm", status,
    started_at: "2026-10-01T00:00:00Z", completed_at: null,
    metrics: null, output_files: null, ...overrides,
  };
}

beforeEach(() => {
  query.data = { runs: [] };
  query.isLoading = false;
  query.isFetching = false;
  query.error = null;
  vi.clearAllMocks();
});

describe("results run-history workbench", () => {
  it("keeps every loaded state and its detail route rather than treating all runs as completed", () => {
    const statuses = ["completed", "queued", "running", "loading", "failed", "cancelled", "unknown"];
    query.data = { runs: statuses.map(status => run(status, status)) };
    render(<ResultsIndexPage />);
    const history = within(screen.getByRole("list", { name: "Run history" }));
    expect(history.getAllByRole("listitem")).toHaveLength(statuses.length);
    for (const status of statuses) {
      expect(history.getByText(status)).toBeInTheDocument();
      expect(history.getByRole("link", { name: `Species ${status}` })).toHaveAttribute("href", `/results/${status}`);
    }
    expect(screen.queryByText("Browse and compare completed model runs.")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 7 of 7 loaded runs");
  });

  it("preserves real zero scientific metrics and visible failure guidance", () => {
    query.data = { runs: [run("zero", "completed", { metrics: { auc_mean: 0, tss_mean: 0, presence_records: 0 } }), run("failed", "failed", { error_code: "NO_LAYERS", error: "Layers unavailable", error_hint: "Choose environmental layers" })] };
    render(<ResultsIndexPage />);
    expect(screen.getByText("AUC: 0.000")).toBeInTheDocument();
    expect(screen.getByText("TSS: 0.000")).toBeInTheDocument();
    expect(screen.getByText("Records: 0")).toBeInTheDocument();
    expect(screen.getByText("NO_LAYERS")).toBeInTheDocument();
    expect(screen.getByText("Layers unavailable")).toBeInTheDocument();
    expect(screen.getByText("Choose environmental layers")).toBeInTheDocument();
  });

  it("shows a useful first-run state rather than empty scientific metrics", () => {
    render(<ResultsIndexPage />);
    expect(screen.getByRole("heading", { name: "No model runs yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Prepare occurrence data" })).toHaveAttribute("href", "/data");
    expect(screen.queryByText(/AUC:/)).not.toBeInTheDocument();
  });

  it("does not confuse a failed initial fetch with an empty workspace", () => {
    query.data = undefined;
    query.error = new Error("Fixture backend error");
    render(<ResultsIndexPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Run history could not be loaded");
    expect(screen.queryByText("No model runs yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry run history" }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it("announces a background update without hiding the existing run", () => {
    query.data = { runs: [run("existing", "completed")] };
    query.isFetching = true;
    render(<ResultsIndexPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Updating run history");
    expect(screen.getByRole("link", { name: "Species existing" })).toBeInTheDocument();
  });

  it("does not turn invalid timestamps into dates or negative durations", () => {
    query.data = { runs: [run("invalid", "completed", { started_at: "not-a-date", completed_at: "also-invalid" }), run("negative", "completed", { started_at: "2026-10-01T01:00:00Z", completed_at: "2026-10-01T00:00:00Z" })] };
    render(<ResultsIndexPage />);
    expect(screen.queryAllByText(/Invalid Date|NaN|-3600s/)).toHaveLength(0);
    expect(screen.getByText(/Start time unavailable/)).toBeInTheDocument();
  });

  it("combines species/model/id search with status filtering and clear recovery", () => {
    query.data = { runs: [run("alpha", "completed", { species: "Acacia alpha" }), run("beta", "failed", { species: "Acacia beta", model_id: "maxent" })] };
    render(<ResultsIndexPage />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), { target: { value: "ACACIA" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Run status" }), { target: { value: "failed" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 2 loaded runs");
    expect(screen.queryByRole("link", { name: "Acacia alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acacia beta" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), { target: { value: "missing" } });
    expect(screen.getByRole("heading", { name: "No runs match these filters" })).toBeInTheDocument();
    expect(screen.queryByText("No model runs yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search runs" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Run status" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 2 loaded runs");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), { target: { value: "maxent" } });
    expect(screen.getByRole("link", { name: "Acacia beta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acacia alpha" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), { target: { value: "alpha" } });
    expect(screen.getByRole("link", { name: "Acacia alpha" })).toBeInTheDocument();
  });

  it("retains cached results with an explicit failed-refresh warning and retry", () => {
    query.data = { runs: [run("cached", "running")] };
    query.error = new Error("Fixture refresh error");
    render(<ResultsIndexPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing cached runs; statuses may be out of date");
    expect(screen.getByRole("link", { name: "Species cached" })).toHaveAttribute("href", "/results/cached");
    fireEvent.click(screen.getByRole("button", { name: "Retry run history" }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it("announces loading without losing the next workflow action", () => {
    query.data = undefined;
    query.isLoading = true;
    render(<ResultsIndexPage />);
    expect(screen.getByRole("heading", { name: "Results", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading run history");
    expect(screen.queryByText("No model runs yet")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure a model" })).toHaveAttribute("href", "/model");
  });
});
