import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clearSharedJobs, useJobSSE } from "./use-job-sse";
import { fetchWithAuth } from "@/services/api";

vi.mock("@/services/api", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: { getState: () => ({ clearAuth: vi.fn() }) } }));

const sources: TestEventSource[] = [];
class TestEventSource {
  handlers = new Map<string, (event: { data: string }) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() { sources.push(this); }
  addEventListener(name: string, handler: (event: { data: string }) => void) { this.handlers.set(name, handler); }
  close() { this.closed = true; }
}

afterEach(() => {
  cleanup();
  clearSharedJobs();
  sources.length = 0;
  vi.mocked(fetchWithAuth).mockReset();
  vi.unstubAllGlobals();
});

describe("clearSharedJobs", () => {
  it("is a callable exported function", () => {
    expect(typeof clearSharedJobs).toBe("function");
  });

  it("is idempotent (calling twice does not throw)", () => {
    expect(() => {
      clearSharedJobs();
      clearSharedJobs();
    }).not.toThrow();
  });

  it("can be called immediately after import without error", () => {
    expect(() => clearSharedJobs()).not.toThrow();
  });

  it("ignores an old stream's queued job event after clearing session state", () => {
    vi.stubGlobal("EventSource", TestEventSource);
    const hook = renderHook(() => useJobSSE(true));
    const old = sources.at(-1)!;
    const queuedCallback = old.handlers.get("job-update")!;
    act(() => clearSharedJobs());
    expect(old.closed).toBe(true);
    act(() => queuedCallback({ data: JSON.stringify({ id: "previous-session-run", state: "active", progress: 10, type: "sdm_model", logs: ["synthetic prior session"] }) }));
    expect(hook.result.current.getJob("previous-session-run")).toBeUndefined();
  });

  it("ignores an old stream's late initial-run response after clearing session state", async () => {
    vi.stubGlobal("EventSource", TestEventSource);
    let complete!: (value: Response) => void;
    vi.mocked(fetchWithAuth).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const hook = renderHook(() => useJobSSE(true));
    act(() => sources.at(-1)!.onopen!());
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    act(() => clearSharedJobs());
    await act(async () => {
      complete(new Response(JSON.stringify({ runs: [{ id: "old-initial-run", status: "running" }] }), { headers: { "Content-Type": "application/json" } }));
    });
    expect(hook.result.current.getJob("old-initial-run")).toBeUndefined();
  });

  it("keeps a replacement stream active when an obsolete stream reports an error", () => {
    vi.stubGlobal("EventSource", TestEventSource);
    const hook = renderHook(({ enabled }) => useJobSSE(enabled), { initialProps: { enabled: true } });
    const old = sources.at(-1)!;
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    const replacement = sources.at(-1)!;
    expect(replacement).not.toBe(old);
    act(() => old.onerror!());
    act(() => replacement.handlers.get("job-update")!({ data: JSON.stringify({ id: "current-run", state: "active", progress: 15, type: "sdm_model", logs: [] }) }));
    expect(hook.result.current.getJob("current-run")?.progress).toBe(15);
  });

  it("ignores an obsolete stream's delayed open event", () => {
    vi.stubGlobal("EventSource", TestEventSource);
    vi.mocked(fetchWithAuth).mockResolvedValue(new Response(JSON.stringify({ runs: [] })));
    const hook = renderHook(() => useJobSSE(true));
    const old = sources.at(-1)!;
    act(() => clearSharedJobs());
    act(() => old.onopen!());
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(hook.result.current.connected).toBe(false);
  });
});
