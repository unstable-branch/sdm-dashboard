import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobProgress } from "./job-progress";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), getJob: vi.fn() }));
vi.mock("@/services/api", () => ({ apiGet: mocks.apiGet, apiPost: vi.fn() }));
vi.mock("@/hooks/use-job-sse", () => ({ useJobSSE: () => ({ connected: true, getJob: mocks.getJob }) }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("finished job timing", () => {
  it.each(["completed", "failed", "cancelled"])("fetches persisted timing even with terminal SSE state: %s", async (state) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T18:00:00Z"));
    const job = { state, progress: 100, logs: [], result: {} };
    mocks.getJob.mockReturnValue(job);
    mocks.apiGet.mockResolvedValue({ status: state, started_at: "2026-10-11T06:21:20.618Z", completed_at: "2026-10-11T06:22:26.541Z" });
    render(<JobProgress jobId="fixture" startTime="2026-10-11T06:21:20.000Z" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/v1/sdm/status/fixture");
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3600000); });
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
  });
});
