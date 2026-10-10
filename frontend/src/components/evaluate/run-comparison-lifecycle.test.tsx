import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@/services/types";
import { RunComparison } from "./run-comparison";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/services/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("./run-comparison-report", () => ({ RunComparisonReport: () => <div>Detailed report fixture</div> }));
const runs: RunSummary[] = ["a", "b"].map(id => ({
  id, species: `Species ${id}`, model_id: "glm", status: "completed",
  started_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-01T01:00:00Z",
  metrics: { auc_mean: 0.5, tss_mean: 0 }, output_files: null,
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("comparison fetch lifecycle", () => {
  it("exposes selection state and enforces the four-run limit after history removes a selection", async () => {
    const history = ["a", "b", "c", "d", "e"].map(id => ({ ...runs[0], id, species: `Species ${id}` }));
    mocks.apiGet.mockResolvedValue({ config: { threshold: 0.5 } });
    const view = render(<RunComparison runs={history} />);
    await act(async () => { await Promise.resolve(); });
    for (const id of ["a", "b", "c", "d"]) {
      fireEvent.click(screen.getByRole("button", { name: `Species ${id} (glm)` }));
      expect(screen.getByRole("button", { name: `Species ${id} (glm)` })).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.getByRole("button", { name: "Species e (glm)" })).toBeDisabled();
    await act(async () => { view.rerender(<RunComparison runs={history.slice(1)} />); });
    fireEvent.click(screen.getByRole("button", { name: "Species e (glm)" }));
    expect(screen.getByRole("button", { name: "Species e (glm)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table", { name: "Run comparison metrics" })).toBeInTheDocument();
  });

  it("does not let an obsolete detail batch overwrite refreshed comparison metrics", async () => {
    const resolveOld: Array<(detail: unknown) => void> = [];
    let calls = 0;
    mocks.apiGet.mockImplementation(() => ++calls <= runs.length
      ? new Promise(resolve => { resolveOld.push(resolve); })
      : Promise.resolve({ config: { threshold: 0.8 } }));
    const view = render(<RunComparison runs={runs} />);
    fireEvent.click(screen.getByRole("button", { name: "Species a (glm)" }));
    const refreshed = runs.map(run => ({ ...run, metrics: { auc_mean: 0.8, tss_mean: 0 } }));
    await act(async () => { view.rerender(<RunComparison runs={refreshed} />); });
    expect(screen.getByText("0.800")).toBeInTheDocument();
    await act(async () => { resolveOld.forEach(resolve => resolve({ config: { threshold: 0.3 } })); });
    expect(screen.getByText("0.800")).toBeInTheDocument();
    expect(screen.queryByText("0.500")).not.toBeInTheDocument();
  });

  it("immediately excludes selected runs removed from refreshed history", async () => {
    mocks.apiGet.mockResolvedValue({ config: { threshold: 0.5 } });
    const view = render(<RunComparison runs={runs} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Species a (glm)" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    view.rerender(<RunComparison runs={[runs[1]]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Species a")).not.toBeInTheDocument();
  });

  it("fetches each run once rather than again after its own state updates", async () => {
    // Bound the broken path: extra calls remain pending instead of generating
    // an unbounded microtask/render loop in the regression harness.
    let calls = 0;
    mocks.apiGet.mockImplementation(() => ++calls <= runs.length
      ? Promise.resolve({ config: { threshold: 0.5 } })
      : new Promise(() => {}));
    render(<RunComparison runs={runs} />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Species a (glm)" }));
    expect(screen.getByText("AUC (mean)")).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });
});
