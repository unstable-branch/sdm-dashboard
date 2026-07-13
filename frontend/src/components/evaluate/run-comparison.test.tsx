import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RunComparison } from "./run-comparison";

global.fetch = vi.fn();

const mockRuns = [
  {
    id: "run-1",
    species: "Acacia mearnsii",
    model_id: "glm",
    status: "completed",
    started_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T01:00:00Z",
    metrics: { auc_mean: 0.85, tss_mean: 0.7 },
    output_files: {},
  },
  {
    id: "run-2",
    species: "Eucalyptus globulus",
    model_id: "glm",
    status: "completed",
    started_at: "2024-01-02T00:00:00Z",
    completed_at: "2024-01-02T01:00:00Z",
    metrics: { auc_mean: 0.92, tss_mean: 0.81 },
    output_files: {},
  },
  {
    id: "run-3",
    species: "Pinus radiata",
    model_id: "maxnet",
    status: "running",
    started_at: "2024-01-03T00:00:00Z",
    completed_at: null,
    metrics: null,
    output_files: {},
  },
];

describe("RunComparison", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ config: { threshold: 0.5 } }),
    } as Response);
  });

  it("shows empty state when no completed runs", () => {
    render(<RunComparison runs={[]} />);
    expect(screen.getByText(/No completed runs/i)).toBeInTheDocument();
  });

  it("filters out non-completed runs", () => {
    render(<RunComparison runs={mockRuns} />);
    expect(screen.getByText(/Acacia mearnsii/)).toBeInTheDocument();
    expect(screen.getByText(/Eucalyptus globulus/)).toBeInTheDocument();
    expect(screen.queryByText(/Pinus radiata/)).not.toBeInTheDocument();
  });

  it("renders run selection buttons", () => {
    render(<RunComparison runs={mockRuns} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });

  it("shows comparison table when runs selected", async () => {
    render(<RunComparison runs={mockRuns} />);
    const buttons = screen.getAllByRole("button");
    buttons[0].click();
    buttons[1].click();

    await waitFor(() => {
      expect(screen.getByText(/AUC \(mean\)/i)).toBeInTheDocument();
      expect(screen.getByText(/TSS \(mean\)/i)).toBeInTheDocument();
    });
  });

  it("highlights best AUC value", async () => {
    render(<RunComparison runs={mockRuns} />);
    const buttons = screen.getAllByRole("button");
    buttons[0].click();
    buttons[1].click();

    await waitFor(() => {
      expect(screen.getByText("0.920")).toBeInTheDocument();
    });
  });
});
