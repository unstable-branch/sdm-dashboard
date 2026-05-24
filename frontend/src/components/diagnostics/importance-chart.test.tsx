import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportanceChart } from "@/components/diagnostics/importance-chart";

describe("ImportanceChart", () => {
  it("shows loading state", () => {
    render(<ImportanceChart data={null} loading={true} />);
    expect(screen.getByText("Loading importance data...")).toBeTruthy();
  });

  it("shows message when not available", () => {
    render(<ImportanceChart data={{ available: false, message: "Not computed" }} loading={false} />);
    expect(screen.getByText("Not computed")).toBeTruthy();
  });

  it("shows error message", () => {
    render(<ImportanceChart data={{ available: false, error: "Failed" }} loading={false} />);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("renders chart with importance data", () => {
    const data = {
      available: true,
      n_variables: 2,
      importance: [
        { variable: "bio1", importance: 0.15, sd: 0.02, baseline: 0.82 },
        { variable: "bio12", importance: 0.08, sd: 0.01, baseline: 0.82 },
      ],
    };
    render(<ImportanceChart data={data} loading={false} />);
    expect(screen.getByText(/Permutation importance/)).toBeTruthy();
  });

  it("handles empty importance array", () => {
    const data = { available: true, n_variables: 0, importance: [] };
    render(<ImportanceChart data={data} loading={false} />);
    expect(screen.getByText("No importance data to display")).toBeTruthy();
  });
});
