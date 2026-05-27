import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AleChart } from "./ale-chart";

describe("AleChart", () => {
  it("shows loading state", () => {
    render(<AleChart data={null} loading={true} />);
    expect(screen.getByText("Loading ALE curves...")).toBeDefined();
  });

  it("shows empty state when no data", () => {
    render(<AleChart data={{ available: false, message: "ALE not available" }} loading={false} />);
    expect(screen.getByText("ALE data not available for this run")).toBeDefined();
  });

  it("renders ALE curves for covariates", () => {
    const data = {
      available: true,
      n_curves: 2,
      curves: [
        { covariate: "bio1", points: [{ value: 10, ale: -0.1 }, { value: 20, ale: 0.2 }] },
        { covariate: "bio12", points: [{ value: 500, ale: 0.05 }, { value: 1000, ale: -0.05 }] },
      ],
    };
    render(<AleChart data={data} loading={false} />);
    expect(screen.getByText("bio1")).toBeDefined();
    expect(screen.getByText("bio12")).toBeDefined();
  });
});
