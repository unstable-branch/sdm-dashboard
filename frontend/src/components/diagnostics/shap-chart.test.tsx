import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShapChart } from "./shap-chart";

describe("ShapChart", () => {
  it("shows loading state", () => {
    render(<ShapChart data={null} loading={true} />);
    expect(screen.getByText("Loading SHAP values...")).toBeDefined();
  });

  it("shows empty state with message", () => {
    render(<ShapChart data={{ available: false, message: "No SHAP data" }} loading={false} />);
    expect(screen.getByText("Click a cell on the suitability map to explain its prediction")).toBeDefined();
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
    expect(screen.getByText("bio1")).toBeDefined();
    expect(screen.getByText("bio12")).toBeDefined();
  });

  it("sorts SHAP values by absolute magnitude", () => {
    const data = {
      available: true,
      shap: [
        { variable: "bio1", value: 25, shap_value: 0.1 },
        { variable: "bio12", value: 800, shap_value: -0.5 },
      ],
    };
    const { container } = render(<ShapChart data={data} loading={false} />);
    const bars = container.querySelectorAll(".recharts-bar-rectangle");
    expect(bars.length).toBe(2);
  });
});
