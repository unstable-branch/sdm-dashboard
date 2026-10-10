import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@/services/types";
import DownloadsPage from "./page";

const query = vi.hoisted(() => ({ data: [] as RunSummary[], isLoading: false, isFetching: false, error: null as Error | null, refetch: vi.fn() }));
vi.mock("@/hooks/use-runs", () => ({ useCompletedRuns: () => query }));
function run(id: string, output_files: RunSummary["output_files"]): RunSummary {
  return { id, species: `Species ${id}`, model_id: "glm", status: "completed", started_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-01T01:00:00Z", metrics: null, output_files };
}
beforeEach(() => { vi.clearAllMocks(); query.data = []; query.isLoading = false; query.isFetching = false; query.error = null; });

describe("downloads output workbench", () => {
  it("keeps background refresh visible without hiding cached files", () => {
    query.data = [run("refresh", { report: "outputs/refresh/report.txt" })];
    query.isFetching = true;
    render(<DownloadsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Updating output list");
    expect(screen.getByRole("link", { name: "Text report" })).toBeInTheDocument();
  });

  it("associates each download with its run and keeps paths behind progressive disclosure", () => {
    query.data = [run("context", { report: "outputs/context/private report.txt" })];
    render(<DownloadsPage />);
    expect(screen.getByRole("link", { name: "Review run context" })).toHaveAttribute("href", "/results/context");
    expect(screen.getByRole("link", { name: "Text report" })).toHaveAccessibleDescription(/Species context.*glm.*context.*report/);
    expect(screen.getByText("outputs/context/private report.txt").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "Text report" })).toHaveAttribute("href", "/api/v1/results/file/outputs%2Fcontext%2Fprivate%20report.txt");
  });

  it("does not count an empty output map as an output-bearing run", () => {
    query.data = [run("empty", {})];
    render(<DownloadsPage />);
    expect(screen.getByRole("heading", { name: "No outputs reported" })).toBeInTheDocument();
    expect(screen.queryByText("No outputs match these filters")).not.toBeInTheDocument();
  });

  it("ignores non-file output metadata while preserving exact valid paths", () => {
    query.data = [run("mixed", { map: "outputs/mixed/map.TIF", blank: "", missing: undefined, malformed: 0 } as unknown as RunSummary["output_files"])];
    render(<DownloadsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 1 listed files");
    expect(screen.getByRole("link", { name: "GeoTIFF" })).toHaveAttribute("href", "/api/v1/results/file/outputs%2Fmixed%2Fmap.TIF");
    expect(screen.queryByText("malformed")).not.toBeInTheDocument();
  });

  it("combines run/output search with file-format filtering and clear recovery", () => {
    query.data = [run("alpha", { map: "outputs/alpha/map.TIF", diagnostic: "outputs/alpha/plot.PNG" }), run("beta", { report: "outputs/beta/report.txt" })];
    render(<DownloadsPage />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search outputs" }), { target: { value: "SPECIES ALPHA" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Output format" }), { target: { value: "png" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 listed files");
    expect(screen.getByRole("link", { name: "PNG image" })).toHaveAttribute("href", "/api/v1/results/file/outputs%2Falpha%2Fplot.PNG");
    expect(screen.queryByRole("link", { name: "Text report" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search outputs" }), { target: { value: "absent" } });
    expect(screen.getByRole("heading", { name: "No outputs match these filters" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search outputs" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Output format" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 3 of 3 listed files");
  });

  it("retains cached file links after a failed refresh and retries without reloading the page", () => {
    query.data = [run("cached", { report: "outputs/cached/report.txt" })];
    query.error = new Error("Private fixture failure");
    render(<DownloadsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing cached outputs; the file list may be out of date");
    expect(screen.getByRole("link", { name: "Text report" })).toHaveAttribute("href", "/api/v1/results/file/outputs%2Fcached%2Freport.txt");
    fireEvent.click(screen.getByRole("button", { name: "Retry output list" }));
    expect(query.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText("Private fixture failure")).not.toBeInTheDocument();
  });

  it("does not claim an empty library when the initial request failed", () => {
    query.error = new Error("Fixture failure");
    render(<DownloadsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Downloadable outputs could not be loaded");
    expect(screen.queryByText("No outputs available")).not.toBeInTheDocument();
  });

  it("announces loading while preserving the run-history route", () => {
    query.isLoading = true;
    render(<DownloadsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading downloadable outputs");
    expect(screen.getByRole("link", { name: "View run history" })).toHaveAttribute("href", "/results");
  });
});
