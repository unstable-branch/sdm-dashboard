import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clearSharedJobs, useJobSSE } from "./use-job-sse";
import { publishLogoutFinished, withSessionMutation } from "@/services/session-coordinator";

const sources: TestEventSource[] = [];
class TestEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string | URL, public options?: EventSourceInit) { sources.push(this); }
  addEventListener() {}
  close() { this.closed = true; }
}

describe("SSE recovery through the browser-session API coordinator", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    class TestChannel { onmessage: ((event: MessageEvent) => void) | null = null; postMessage() {} }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: vi.fn(async (_name: string, _options: unknown, operation: () => Promise<unknown>) => operation()) },
    });
    vi.stubGlobal("EventSource", TestEventSource);
    sources.length = 0;
  });

  afterEach(async () => {
    cleanup();
    clearSharedJobs();
    await withSessionMutation(async () => { publishLogoutFinished(true); });
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    vi.useRealTimers();
  });

  it("refreshes a confirmed expired access read through fetchWithAuth before reconnecting", async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/v1/sdm/runs?status=running&limit=10") {
        return requests.filter((item) => item === url).length === 1
          ? new Response("{}", { status: 401 })
          : new Response(JSON.stringify({ runs: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/v1/auth/refresh") return new Response('{"ok":true}', { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderHook(() => useJobSSE(true));
    const oldSource = sources[0];
    act(() => oldSource.onerror!());
    await act(async () => { await vi.waitFor(() => expect(requests).toHaveLength(3)); });

    expect(requests).toEqual([
      "/api/v1/sdm/runs?status=running&limit=10",
      "/api/v1/auth/refresh",
      "/api/v1/sdm/runs?status=running&limit=10",
    ]);
    expect(sources).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(sources).toHaveLength(2);
  });

  it("delegates confirmed expiry to the canonical session-expired event and never infers logout itself", async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return new Response("{}", { status: 401 });
    }));
    const expired = vi.fn(() => clearSharedJobs());
    window.addEventListener("sdm:session-expired", expired);
    renderHook(() => useJobSSE(true));
    const oldSource = sources[0];
    act(() => oldSource.onerror!());
    await act(async () => { await vi.waitFor(() => expect(expired).toHaveBeenCalledTimes(1)); });

    expect(requests).toEqual([
      "/api/v1/sdm/runs?status=running&limit=10",
      "/api/v1/auth/refresh",
    ]);
    expect(sources).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sources).toHaveLength(1);
    window.removeEventListener("sdm:session-expired", expired);
  });
});
