import { describe, expect, it, vi } from "vitest";
import { completedRunFields } from "./completed-run.js";
import type { PlumberClient } from "./plumber.js";

describe("completedRunFields", () => {
  it("persists output files and unwraps the provenance manifest", async () => {
    const client = {
      getOutputManifest: vi.fn().mockResolvedValue({ manifest: { data: { record_count: 87 } } }),
    } as unknown as PlumberClient;

    const result = await completedRunFields(client, "job-123", {
      metrics: { auc_mean: 0.9 },
      output_files: { report: "/app/outputs/jobs/job-123/species_report.txt" },
    });

    expect(client.getOutputManifest).toHaveBeenCalledWith("job-123");
    expect(result.outputFiles).toEqual({ report: "/app/outputs/jobs/job-123/species_report.txt" });
    expect(result.provenance).toEqual({ data: { record_count: 87 } });
  });

  it("keeps completed artifacts when provenance lookup fails", async () => {
    const client = {
      getOutputManifest: vi.fn().mockRejectedValue(new Error("unavailable")),
    } as unknown as PlumberClient;

    const result = await completedRunFields(client, "job-123", { output_files: { tif: "model.tif" } });
    expect(result.outputFiles).toEqual({ tif: "model.tif" });
    expect(result.provenance).toBeNull();
  });
});
