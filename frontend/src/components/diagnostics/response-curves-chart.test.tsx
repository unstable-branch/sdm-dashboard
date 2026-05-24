import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResponseCurvesChart } from "@/components/diagnostics/response-curves-chart";

describe("ResponseCurvesChart", () => {
  it("shows loading state", () => {
    render(<ResponseCurvesChart data={null} loading={true} />);
    expect(screen.getByText("Loading response curves...")).toBeTruthy();
  });

  it("shows message when not available", () => {
    render(<ResponseCurvesChart data={{ available: false, message: "Not computed" }} loading={false} />);
    expect(screen.getByText("Not computed")).toBeTruthy();
  });

  it("shows error message", () => {
    render(<ResponseCurvesChart data={{ available: false, error: "Failed" }} loading={false} />);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("renders curve toggle buttons", () => {
    const data = {
      available: true,
      n_curves: 2,
      curves: [
        { covariate: "bio1", points: [{ value: 10, suitability: 0.3 }] },
        { covariate: "bio12", points: [{ value: 500, suitability: 0.7 }] },
      ],
    };
    render(<ResponseCurvesChart data={data} loading={false} />);
    expect(screen.getByText("bio1")).toBeTruthy();
    expect(screen.getByText("bio12")).toBeTruthy();
  });
});
