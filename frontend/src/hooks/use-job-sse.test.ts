import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clearSharedJobs, useJobSSE } from "./use-job-sse";
import { fetchWithAuth } from "@/services/api";

vi.mock("@/services/api", () => ({ fetchWithAuth: vi.fn() }));
const authMocks = vi.hoisted(() => ({ clearAuth: vi.fn() }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: { getState: () => ({ clearAuth: authMocks.clearAuth }) } }));

const sources: TestEventSource[] = [];
class TestEventSource {
  static instances: TestEventSource[] = [];
  handlers = new Map<string, (event: { data: string }) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;
  options: EventSourceInit | undefined;
  constructor(url: string | URL, options?: EventSourceInit) { this.url = String(url); this.options = options; sources.push(this); TestEventSource.instances.push(this); }
  addEventListener(name: string, handler: (event: { data: string }) => void) { this.handlers.set(name, handler); }
  close() { this.closed = true; }
}

afterEach(() => {
  cleanup();
  clearSharedJobs();
  sources.length = 0;
  TestEventSource.instances.length = 0;
  vi.mocked(fetchWithAuth).mockReset();
  authMocks.clearAuth.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
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

  it("does not infer logout from repeated short-lived transport errors", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", TestEventSource);
    vi.mocked(fetchWithAuth).mockResolvedValue(new Response(JSON.stringify({ runs: [] }), { headers: { "Content-Type": "application/json" } }));
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    renderHook(() => useJobSSE(true));
    let source = sources[0];
    act(() => source.onopen!());
    await act(async () => { await Promise.resolve(); });
    for (let attempt = 0; attempt < 3; attempt++) {
      act(() => source.onerror!());
      await act(async () => { await Promise.resolve(); });
      if (attempt < 2) {
        await act(async () => { await vi.advanceTimersByTimeAsync(3000 * (2 ** attempt)); });
        vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
        source = sources.at(-1)!;
      }
    }
    expect(authMocks.clearAuth).not.toHaveBeenCalled();
  });

  it("never opens a credentialed EventSource to a foreign configured origin", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://attacker.example");
    vi.stubGlobal("EventSource", TestEventSource);
    renderHook(() => useJobSSE(true));
    expect(sources).toHaveLength(0);
  });

  it("opens the job stream with credentials on the same origin only", () => {
    vi.stubGlobal("EventSource", TestEventSource);
    renderHook(() => useJobSSE(true));
    expect(sources[0].url).toBe("/api/v1/jobs/sse");
    expect(sources[0].options).toEqual({ withCredentials: true });
  });

  it("status-checks a stream error through fetchWithAuth before reconnecting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", TestEventSource);
    vi.mocked(fetchWithAuth).mockResolvedValue(new Response(JSON.stringify({ runs: [] }), { headers: { "Content-Type": "application/json" } }));
    renderHook(() => useJobSSE(true));
    const source = sources[0];
    act(() => source.onerror!());
    await act(async () => { await Promise.resolve(); });
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/v1/sdm/runs?status=running&limit=10");
    expect(sources).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(sources).toHaveLength(2);
  });

  it("does not reconnect when clearSharedJobs wins while recovery is pending", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", TestEventSource);
    let resolve!: (response: Response) => void;
    vi.mocked(fetchWithAuth).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderHook(() => useJobSSE(true));
    const source = sources[0];
    act(() => source.onerror!());
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    act(() => clearSharedJobs());
    await act(async () => { resolve(new Response(JSON.stringify({ runs: [] }))); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sources).toHaveLength(1);
  });

  it("invalidates pending recovery and old callbacks when the principal changes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", TestEventSource);
    let resolve!: (response: Response) => void;
    vi.mocked(fetchWithAuth).mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = renderHook(() => useJobSSE(true));
    const old = sources[0];
    act(() => old.onerror!());
    act(() => window.dispatchEvent(new CustomEvent("sdm:session-changed")));
    await act(async () => { resolve(new Response(JSON.stringify({ runs: [] }))); await Promise.resolve(); });
    act(() => old.handlers.get("job-update")!({ data: JSON.stringify({ id: "previous-principal-run", state: "active", progress: 90, type: "sdm_model", logs: [] }) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(hook.result.current.getJob("previous-principal-run")).toBeUndefined();
    expect(sources).toHaveLength(1);
  });

  it("does not resurrect a stream when recovery completes after unmount", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", TestEventSource);
    let resolve!: (response: Response) => void;
    vi.mocked(fetchWithAuth).mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = renderHook(() => useJobSSE(true));
    const source = sources[0];
    act(() => source.onerror!());
    hook.unmount();
    await act(async () => { resolve(new Response(JSON.stringify({ runs: [] }))); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sources).toHaveLength(1);
  });
});
