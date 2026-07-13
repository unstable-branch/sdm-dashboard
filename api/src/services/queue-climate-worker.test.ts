import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./queue.js", () => ({
  CLIMATE_DOWNLOAD_POLL_INTERVAL_MS: 1,
  CLIMATE_DOWNLOAD_MAX_ATTEMPTS: 2,
}));

const { emitJobStatus } = vi.hoisted(() => ({ emitJobStatus: vi.fn() }));
vi.mock("./job-events.js", () => ({
  jobEventBus: { emitJobStatus },
}));

import { handleClimateJob, handleCovariateJob } from "./queue-climate-worker.js";

function fakeJob(type: string) {
  return {
    id: `${type}-job`,
    data: { type, payload: {} },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe("climate/covariate worker terminal progress", () => {
  beforeEach(() => {
    emitJobStatus.mockClear();
  });

  it("returns an error after repeated covariate poll failures instead of false success", async () => {
    const job = fakeJob("covariate_download");
    const client = {
      downloadCovariateBg: vi.fn().mockResolvedValue({ job_id: "plumber-cov" }),
      getJobStatus: vi.fn().mockRejectedValue(new Error("plumber unavailable")),
    } as never;

    const result = await handleCovariateJob(job, client, undefined);

    expect(result.status).toBe("error");
    expect(result.error_code).toBe("PLUMBER_TIMEOUT");
    expect(result.error).toContain("last poll error: plumber unavailable");
    expect((job as { updateProgress: ReturnType<typeof vi.fn> }).updateProgress).not.toHaveBeenCalledWith(100);
    expect(emitJobStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: "failed", progress: 20 }));
  });

  it("does not report 100 for a failed climate download", async () => {
    const job = fakeJob("climate_download");
    const client = {
      downloadClimate: vi.fn().mockResolvedValue({ job_id: "plumber-climate" }),
      getClimateStatus: vi.fn().mockResolvedValue({ status: "failed", error: "disk full", progress_log: ["[42%] downloading"] }),
    } as never;

    const result = await handleClimateJob(job, client, undefined);

    expect(result.status).toBe("error");
    expect((job as { updateProgress: ReturnType<typeof vi.fn> }).updateProgress).not.toHaveBeenCalledWith(100);
    expect(emitJobStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: "failed", progress: 20 }));
  });

  it("reports 100 only for a completed covariate download", async () => {
    const job = fakeJob("covariate_download");
    const client = {
      downloadCovariateBg: vi.fn().mockResolvedValue({ job_id: "plumber-cov" }),
      getJobStatus: vi.fn().mockResolvedValue({ status: "completed", progress_log: ["[100%] complete"] }),
    } as never;

    const result = await handleCovariateJob(job, client, undefined);

    expect(result.status).toBe("success");
    expect((job as { updateProgress: ReturnType<typeof vi.fn> }).updateProgress).toHaveBeenLastCalledWith(100);
    expect(emitJobStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: "completed", progress: 100 }));
  });
});
