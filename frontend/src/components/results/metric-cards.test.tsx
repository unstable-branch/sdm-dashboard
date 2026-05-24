import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricCards } from "./metric-cards";

describe("MetricCards", () => {
  const mockMetrics = {
    auc_mean: 0.852,
    auc_sd: 0.034,
    tss_mean: 0.701,
    tss_sd: 0.056,
    presence_records: 150,
    background_points: 10000,
    elapsed_seconds: 42,
  };

  it("renders all metric cards", () => {
    render(<MetricCards metrics={mockMetrics} />);
    expect(screen.getByText("AUC (mean)")).toBeInTheDocument();
    expect(screen.getByText("TSS (mean)")).toBeInTheDocument();
    expect(screen.getByText("Presence records")).toBeInTheDocument();
    expect(screen.getByText("Background points")).toBeInTheDocument();
  });

  it("formats AUC to 3 decimal places", () => {
    render(<MetricCards metrics={mockMetrics} />);
    expect(screen.getByText("0.852")).toBeInTheDocument();
  });

  it("formats TSS to 3 decimal places", () => {
    render(<MetricCards metrics={mockMetrics} />);
    expect(screen.getByText("0.701")).toBeInTheDocument();
  });

  it("formats elapsed seconds with suffix", () => {
    render(<MetricCards metrics={mockMetrics} />);
    expect(screen.getByText("42s")).toBeInTheDocument();
  });

  it("formats large numbers with locale", () => {
    render(<MetricCards metrics={mockMetrics} />);
    expect(screen.getByText("10,000")).toBeInTheDocument();
  });

  it("shows dash for missing metrics", () => {
    render(<MetricCards metrics={{}} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it("handles null metric values", () => {
    render(<MetricCards metrics={{ auc_mean: null, tss_mean: null }} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
