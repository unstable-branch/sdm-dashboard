import { describe, expect, it } from "vitest";
import { dashboardNavItems, pipelineItems } from "./dashboard-nav";

describe("dashboard navigation", () => {
  it("does not advertise the retired batch tab", () => {
    expect(pipelineItems.map((item) => item.title)).not.toContain("Batch");
    expect(dashboardNavItems.map((item) => item.href)).not.toContain("/data?tab=batch");
  });
});
