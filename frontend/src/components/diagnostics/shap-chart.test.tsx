import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatShapChartData, ShapChart } from "./shap-chart";

describe("ShapChart", () => {
  it("shows loading state", () => {
    render(<ShapChart data={null} loading={true} />);
    expect(screen.getByText("Loading SHAP values...")).toBeDefined();
  });

  it("shows empty state with message", () => {
    render(<ShapChart data={{ available: false, message: "No SHAP data" }} loading={false} />);
    expect(screen.getByText("No SHAP data")).toBeDefined();
  });

  it("renders chart with SHAP data", () => {
    const data = {
      available: true,
      prediction: 0.75,
      shap: [
        { variable: "bio1", value: 25, shap_value: 0.3 },
        { variable: "bio12", value: 800, shap_value: -0.1 },
      ],
    };
    render(<ShapChart data={data} loading={false} />);
    expect(screen.getByText("0.750")).toBeDefined();
    expect(screen.getByText(/SHAP values show/)).toBeDefined();
  });

  it("sorts SHAP values by absolute magnitude", () => {
    const chartData = formatShapChartData([
      { variable: "bio1", value: 25, shap_value: 0.1 },
      { variable: "bio12", value: 800, shap_value: -0.5 },
    ]);
    expect(chartData.map((d) => d.variable)).toEqual(["bio12", "bio1"]);
  });
});
