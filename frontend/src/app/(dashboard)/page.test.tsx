import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

const queries = vi.hoisted(() => ({
  summary: { data: [] as unknown[], isLoading: false, error: null as Error | null, refetch: vi.fn() },
  history: { data: { runs: [] as unknown[] }, isLoading: false, error: null as Error | null, refetch: vi.fn() },
}));
vi.mock("@/hooks/use-runs", () => ({ useCompletedRuns: () => queries.summary, useRuns: () => queries.history }));
vi.mock("next/dynamic", () => ({ default: () => () => <div>Suitability map fixture</div> }));
beforeEach(() => {
  queries.summary.data = [];
  queries.history.data = { runs: [] };
  queries.summary.isLoading = false;
  queries.history.isLoading = false;
  queries.summary.error = null;
  queries.history.error = null;
  vi.clearAllMocks();
});

describe("dashboard workbench overview", () => {
  const completedRun = {
    id: "completed-fixture", species: "Fixture species", model_id: "glm", status: "completed",
    started_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-01T01:00:00Z",
    metrics: { presence_records: 0, auc_mean: 0, auc_sd: 0, high_suitability_area_km2: 0 }, output_files: null,
  };

  it("keeps navigation available while independently announcing loading", () => {
    queries.summary.isLoading = true;
    queries.history.isLoading = true;
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workflow shortcuts" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.queryByText("No completed runs yet")).not.toBeInTheDocument();
  });

  it("does not present failed requests as an empty workspace and retries each query separately", () => {
    queries.summary.error = new Error("Fixture summary error");
    queries.history.error = new Error("Fixture history error");
    render(<DashboardPage />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText("No completed runs yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry summary" }));
    expect(queries.summary.refetch).toHaveBeenCalledTimes(1);
    expect(queries.history.refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry recent runs" }));
    expect(queries.history.refetch).toHaveBeenCalledTimes(1);
  });

  it("retains the completed-run scientific metrics including real zeros, map and detail links", () => {
    queries.summary.data = [completedRun];
    queries.history.data = { runs: [completedRun] };
    render(<DashboardPage />);
    const summary = within(screen.getByRole("region", { name: "Completed run summary" }));
    expect(summary.getByText("0")).toBeInTheDocument();
    expect(summary.getByText("0.000")).toBeInTheDocument();
    expect(summary.getByText("SD ±0.000")).toBeInTheDocument();
    expect(summary.getByText("0 km²")).toBeInTheDocument();
    expect(screen.getByText("Suitability map fixture")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all runs" })).toHaveAttribute("href", "/results");
    expect(screen.getByRole("link", { name: "Open run details and evaluation" })).toHaveAttribute("href", "/results/completed-fixture");
  });

  it("labels cached summary and run history as potentially stale after a failed refresh", () => {
    queries.summary.data = [completedRun];
    queries.history.data = { runs: [completedRun] };
    queries.summary.error = new Error("Fixture stale summary");
    queries.history.error = new Error("Fixture stale history");
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Last available completed run" })).toBeInTheDocument();
    expect(screen.getByText(/Showing cached runs; statuses may be out of date/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the last available summary; it may be out of date/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Recent runs" })).toBeInTheDocument();
  });

  it("retains running, failed, cancelled and unknown states without labelling them successful", () => {
    queries.history.data = { runs: ["running", "failed", "cancelled", "queued", "unknown"].map((status) => ({ ...completedRun, id: status, species: `Species ${status}`, status, completed_at: null })) };
    render(<DashboardPage />);
    const table = within(screen.getByRole("table", { name: "Recent runs" }));
    for (const status of ["running", "failed", "cancelled", "queued", "unknown"]) {
      expect(table.getByText(status)).toBeInTheDocument();
      expect(table.getByRole("link", { name: `Species ${status}` })).toHaveAttribute("href", `/results/${status}`);
    }
    expect(table.queryByText("completed")).not.toBeInTheDocument();
  });

  it("leads with workflow actions instead of empty metrics and duplicate onboarding", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("navigation", { name: "Workflow shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Prepare occurrence data/ })).toHaveAttribute("href", "/data");
    expect(screen.queryByText("Getting Started")).not.toBeInTheDocument();
    expect(screen.queryByText("AUC")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Batch processing" })).not.toBeInTheDocument();
    expect(screen.getByText("No completed runs yet")).toBeInTheDocument();
  });
});
