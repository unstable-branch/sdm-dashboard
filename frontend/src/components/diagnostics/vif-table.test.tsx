import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VifTable } from "@/components/diagnostics/vif-table";

describe("VifTable", () => {
  it("shows loading state", () => {
    render(<VifTable data={null} loading={true} />);
    expect(screen.getByText("Loading VIF data...")).toBeTruthy();
  });

  it("shows message when VIF not available", () => {
    render(<VifTable data={{ available: false, message: "VIF not enabled" }} loading={false} />);
    expect(screen.getByText("VIF not enabled")).toBeTruthy();
  });

  it("shows error message", () => {
    render(<VifTable data={{ available: false, error: "Failed to load" }} loading={false} />);
    expect(screen.getByText("Failed to load")).toBeTruthy();
  });

  it("renders selected and dropped variables", () => {
    const data = {
      available: true,
      selected: ["bio1", "bio12"],
      dropped: ["bio2"],
      vif_final: 5.2,
      vif_history: [{ iteration: 1, variable_removed: "bio2", max_vif: 15.3 }],
      var_means: { bio1: 20.5, bio12: 800 },
      var_sds: { bio1: 3.2, bio12: 120 },
    };
    render(<VifTable data={data} loading={false} />);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("bio2")).toBeTruthy();
    expect(screen.getByText("bio1")).toBeTruthy();
  });
});
