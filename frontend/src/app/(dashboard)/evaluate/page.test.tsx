import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunDetail, RunSummary } from "@/services/types";
import EvaluatePage from "./page";

const mocks = vi.hoisted(() => ({
  query: { data: { runs: [] as RunSummary[] }, isLoading: false, error: null as Error | null, refetch: vi.fn() },
  apiGet: vi.fn(),
}));
vi.mock("@/hooks/use-runs", () => ({ useRuns: () => mocks.query }));
vi.mock("@/services/api", () => ({ apiGet: mocks.apiGet }));
vi.mock("next/dynamic", () => ({ default: () => ({ runId }: { runId?: string }) => runId ? <div>Map run: {runId}</div> : <div>Diagnostic chart</div> }));
vi.mock("@/components/evaluate/run-comparison", () => ({ RunComparison: () => <div>Comparison fixture</div> }));
vi.mock("@/components/evaluate/threshold-explorer", () => ({ ThresholdExplorer: ({ aucMean }: { aucMean?: unknown }) => <div>Threshold AUC: {String(aucMean)}</div> }));
vi.mock("@/components/diagnostics/vif-table", () => ({ VifTable: () => <div>VIF fixture</div> }));

function run(id: string): RunDetail {
  return {
    id, species: `Species ${id}`, model_id: "glm", status: "completed",
    started_at: "2026-10-01T00:00:00Z", completed_at: id === "new" ? "2026-10-01T02:00:00Z" : "2026-10-01T01:00:00Z",
    metrics: { auc_mean: id === "new" ? 0.9 : 0.4 }, output_files: null, error: null, progress_log: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.data = { runs: [run("new"), run("old")] };
  mocks.query.isLoading = false;
  mocks.query.error = null;
  mocks.apiGet.mockImplementation((url: string) => Promise.resolve(url.endsWith("/new") ? run("new") : run("old")));
});

describe("evaluation run ownership", () => {
  it("treats a backend-declared diagnostic error as failure rather than absent output", async () => {
    mocks.apiGet.mockImplementation((url: string) => Promise.resolve(url.includes("/diagnostics/cbi/")
      ? { available: false, error: "Private provider payload error" }
      : url.includes("/diagnostics/") ? { available: false } : run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("CBI could not be loaded");
    expect(screen.queryByText("Private provider payload error")).not.toBeInTheDocument();
  });

  it("shows ready diagnostics while another endpoint is pending", async () => {
    mocks.apiGet.mockImplementation((url: string) => url.includes("/diagnostics/response-curves/")
      ? new Promise(() => {})
      : Promise.resolve(url.includes("/diagnostics/") ? { available: true } : run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading Response curves");
    expect(within(screen.getByRole("tabpanel")).getAllByText("Diagnostic chart")).toHaveLength(2);
  });

  it("does not attach a late diagnostic failure to a different selected run", async () => {
    let rejectOld!: (error: Error) => void;
    mocks.apiGet.mockImplementation((url: string) => url === "/api/v1/diagnostics/cbi/old"
      ? new Promise((_, reject) => { rejectOld = reject; })
      : Promise.resolve(url.includes("/diagnostics/") ? { available: false } : url.endsWith("/old") ? run("old") : run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "old" } });
    await screen.findByText("Map run: old");
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "new" } });
    await screen.findByText("Map run: new");
    await act(async () => { rejectOld(new Error("Late fixture failure")); });
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains declared PNG output when JSON diagnostics report unavailable", async () => {
    const detail = { ...run("new"), output_files: { variable_importance_png: "importance.png", response_curves_png: "curves.png", cbi_png: "cbi.png" } };
    mocks.apiGet.mockImplementation((url: string) => Promise.resolve(url.includes("/diagnostics/") ? { available: false } : detail));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(screen.getByRole("img", { name: "Variable importance PNG" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Response curves PNG" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "CBI PNG" })).toBeInTheDocument();
  });

  it.each([
    ["vif", "VIF", "VIF"],
    ["importance", "Variable importance", "Diagnostics"],
    ["response-curves", "Response curves", "Diagnostics"],
    ["cbi", "CBI", "Diagnostics"],
  ])("distinguishes a failed %s request from absent output and retries only that endpoint", async (endpoint, label, tab) => {
    mocks.apiGet.mockImplementation((url: string) => url.includes(`/diagnostics/${endpoint}/`)
      ? Promise.reject(new Error("Private provider failure detail"))
      : Promise.resolve(url.includes("/diagnostics/") ? { available: false } : run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${label} could not be loaded`);
    expect(screen.queryByText("Private provider failure detail")).not.toBeInTheDocument();
    mocks.apiGet.mockClear();
    mocks.apiGet.mockResolvedValue({ available: false });
    fireEvent.click(screen.getByRole("button", { name: `Retry ${label}` }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(mocks.apiGet).toHaveBeenCalledWith(`/api/v1/diagnostics/${endpoint}/new`);
  });

  it.each([null, undefined, "", "  ", false, true, [], Number.NaN, Number.POSITIVE_INFINITY].map(value => ({ value })))("does not coerce missing or invalid AUC $value to zero", async ({ value }) => {
    mocks.apiGet.mockResolvedValue({ ...run("new"), metrics: { auc_mean: value } });
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(screen.getByText("AUC").parentElement).toHaveTextContent(/^AUC—$/);
  });

  it.each([[0, "0.000"], [-0.2, "-0.200"], ["0.75", "0.750"]])("preserves valid metric %j", async (value, expected) => {
    mocks.apiGet.mockResolvedValue({ ...run("new"), metrics: { auc_mean: value } });
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
    expect(screen.getByText("AUC").parentElement).toHaveTextContent(`AUC${expected}`);
  });

  it("ignores a late detail response for a superseded selection", async () => {
    let resolveOld!: (detail: RunDetail) => void;
    mocks.apiGet.mockImplementation((url: string) => url === "/api/v1/sdm/status/old"
      ? new Promise<RunDetail>(resolve => { resolveOld = resolve; })
      : Promise.resolve(run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "old" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "new" } });
    await screen.findByText("Map run: new");
    await act(async () => { resolveOld(run("old")); });
    expect(screen.getByText("Map run: new")).toBeInTheDocument();
    expect(screen.queryByText("Map run: old")).not.toBeInTheDocument();
  });

  it("clears threshold ownership if the selected run leaves completed history", async () => {
    const view = render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.click(screen.getByRole("tab", { name: "Threshold" }));
    expect(screen.getByText("Threshold AUC: 0.9")).toBeInTheDocument();
    mocks.query.data = { runs: [] };
    await act(async () => { view.rerender(<EvaluatePage />); });
    expect(screen.queryByText("Threshold AUC: 0.9")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Evaluation run" })).not.toBeInTheDocument();
  });

  it("shows an explicit run-detail failure with a working retry", async () => {
    mocks.apiGet.mockRejectedValue(new Error("Fixture run-detail failure"));
    render(<EvaluatePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Selected run details could not be loaded");
    expect(screen.queryByText("Map run: new")).not.toBeInTheDocument();
    mocks.apiGet.mockImplementation((url: string) => Promise.resolve(url.endsWith("/new") ? run("new") : run("old")));
    fireEvent.click(screen.getByRole("button", { name: "Retry selected run" }));
    await screen.findByText("Map run: new");
  });

  it("keeps one labelled run selector available across analysis tabs", async () => {
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    expect(screen.getAllByRole("combobox", { name: "Evaluation run" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Threshold" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "old" } });
    await screen.findByText("Threshold AUC: 0.4");
    fireEvent.click(screen.getByRole("tab", { name: "VIF" }));
    expect(screen.getByRole("combobox", { name: "Evaluation run" })).toHaveValue("old");
  });

  it("does not fall back to a different run's threshold metrics during selection", async () => {
    let resolveOld!: (detail: RunDetail) => void;
    mocks.apiGet.mockImplementation((url: string) => url === "/api/v1/sdm/status/old"
      ? new Promise<RunDetail>(resolve => { resolveOld = resolve; })
      : Promise.resolve(run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "old" } });
    fireEvent.click(screen.getByRole("tab", { name: "Threshold" }));
    expect(screen.queryByText("Threshold AUC: 0.9")).not.toBeInTheDocument();
    await act(async () => { resolveOld(run("old")); });
    await screen.findByText("Threshold AUC: 0.4");
  });

  it("loads diagnostics for the automatically selected run", async () => {
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/diagnostics/vif/new"));
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/diagnostics/importance/new");
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/diagnostics/response-curves/new");
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/diagnostics/cbi/new");
  });

  it("preserves an explicit run selection when history refreshes", async () => {
    const view = render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "old" } });
    await screen.findByText("Map run: old");
    mocks.query.data = { runs: [run("new"), run("old")] };
    await act(async () => { view.rerender(<EvaluatePage />); });
    expect(screen.getByText("Map run: old")).toBeInTheDocument();
    expect(screen.queryByText("Map run: new")).not.toBeInTheDocument();
  });

  it("clears the old map as soon as another run is selected", async () => {
    let resolveOld!: (detail: RunDetail) => void;
    mocks.apiGet.mockImplementation((url: string) => url === "/api/v1/sdm/status/old"
      ? new Promise<RunDetail>(resolve => { resolveOld = resolve; })
      : Promise.resolve(run("new")));
    render(<EvaluatePage />);
    await screen.findByText("Map run: new");
    fireEvent.change(screen.getByRole("combobox", { name: "Evaluation run" }), { target: { value: "old" } });
    expect(screen.queryByText("Map run: new")).not.toBeInTheDocument();
    await act(async () => { resolveOld(run("old")); });
    await screen.findByText("Map run: old");
  });
});
