import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./queue.js", () => ({
  CLIMATE_DOWNLOAD_POLL_INTERVAL_MS: 1,
  CLIMATE_DOWNLOAD_MAX_ATTEMPTS: 10,
  CLIMATE_DOWNLOAD_MAX_CONSECUTIVE_POLL_ERRORS: 3,
}));

const { emitJobStatus } = vi.hoisted(() => ({ emitJobStatus: vi.fn() }));
vi.mock("./job-events.js", () => ({
  jobEventBus: { emitJobStatus },
}));

import { handleCovariateJob } from "./queue-climate-worker.js";

function fakeJob(type: string) {
  return {
    id: `${type}-job`,
    data: { type, payload: {} },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe("covariate worker terminal progress", () => {
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
    expect(result.error_code).toBe("PLUMBER_UNREACHABLE");
    expect(result.error).toContain("plumber unavailable");
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

  it("fails covariate job early with PLUMBER_UNREACHABLE after N consecutive poll errors", async () => {
    const job = fakeJob("covariate_download");
    const client = {
      downloadCovariateBg: vi.fn().mockResolvedValue({ job_id: "plumber-cov" }),
      getJobStatus: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    } as never;

    const result = await handleCovariateJob(job, client, undefined);

    expect(result.status).toBe("error");
    expect(result.error_code).toBe("PLUMBER_UNREACHABLE");
    expect(result.error).toContain("Polling failed 3 times in a row");
    expect(result.error).toContain("ECONNRESET");
    expect((job as { updateProgress: ReturnType<typeof vi.fn> }).updateProgress).not.toHaveBeenCalledWith(100);
    expect(emitJobStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "failed", failedReason: expect.stringContaining("ECONNRESET") })
    );
  });
});
