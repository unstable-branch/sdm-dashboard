import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CbiChart } from "@/components/diagnostics/cbi-chart";

describe("CbiChart", () => {
  it("shows loading state", () => {
    render(<CbiChart data={null} loading={true} />);
    expect(screen.getByText("Loading CBI data...")).toBeTruthy();
  });

  it("shows message when not available", () => {
    render(<CbiChart data={{ available: false, message: "Not computed" }} loading={false} />);
    expect(screen.getByText("Not computed")).toBeTruthy();
  });

  it("shows error message", () => {
    render(<CbiChart data={{ available: false, error: "Failed" }} loading={false} />);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("renders CBI value and metrics", () => {
    const data = {
      available: true,
      cbi: 0.75,
      pe_ratio: 2.3,
      n_bins: 51,
      bins: [
        { binMid: 0.1, ratio: 0.5, smoothed: 0.6 },
        { binMid: 0.5, ratio: 1.5, smoothed: 1.8 },
      ],
    };
    render(<CbiChart data={data} loading={false} />);
    expect(screen.getByText("0.750")).toBeTruthy();
    expect(screen.getByText("2.300")).toBeTruthy();
    expect(screen.getByText("51")).toBeTruthy();
  });

  it("shows note when present", () => {
    const data = {
      available: true,
      cbi: 0.3,
      pe_ratio: 1.1,
      n_bins: 51,
      bins: [{ binMid: 0.1, ratio: 0.5, smoothed: 0.6 }],
      note: "Insufficient presence points",
    };
    render(<CbiChart data={data} loading={false} />);
    expect(screen.getByText(/Insufficient presence points/)).toBeTruthy();
  });
});
