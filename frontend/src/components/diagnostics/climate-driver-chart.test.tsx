import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClimateDriverChart } from "./climate-driver-chart";

describe("ClimateDriverChart", () => {
  it("shows loading state", () => {
    render(<ClimateDriverChart data={null} loading={true} />);
    expect(screen.getByText("Loading climate driver analysis...")).toBeDefined();
  });

  it("shows empty state when no future projection", () => {
    render(<ClimateDriverChart data={{ available: false, message: "Future projection not available" }} loading={false} />);
    expect(screen.getByText("Climate driver analysis requires a future projection")).toBeDefined();
  });

  it("renders metric cards with summary data", () => {
    const data = {
      available: true,
      has_future_projection: true,
      summary: {
        mean_delta: -0.15,
        sd_delta: 0.3,
        min_delta: -0.8,
        max_delta: 0.5,
        pct_loss: 45.0,
        pct_gain: 25.0,
        pct_stable: 30.0,
        n_cells: 10000,
      },
    };
    render(<ClimateDriverChart data={data} loading={false} />);
    expect(screen.getByText("45.0%")).toBeDefined();
    expect(screen.getByText("25.0%")).toBeDefined();
    expect(screen.getByText("30.0%")).toBeDefined();
    expect(screen.getByText("10000")).toBeDefined();
  });
});
