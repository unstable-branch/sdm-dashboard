import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGetArrayBuffer } from "@/services/api";
import { currentSessionGeneration } from "@/services/session-coordinator";

let lockRequest: ReturnType<typeof vi.fn>;
class TestChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("BroadcastChannel", TestChannel);
  lockRequest = vi.fn(async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback());
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: lockRequest } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
});

describe("canonical authenticated raster body transport", () => {
  it("refreshes once and retries an expired same-origin tile GET before returning bytes", async () => {
    const tilePath = "/api/v1/results/tiles/run-safe/2/1/2?band=suitability";
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    let tileRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/auth/refresh") return new Response("{}", { status: 200 });
      if (url === tilePath) {
        tileRequests++;
        return tileRequests === 1
          ? new Response('{"error":"expired"}', { status: 401 })
          : new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGetArrayBuffer(tilePath)).resolves.toEqual(bytes);
    expect(tileRequests).toBe(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([tilePath, "/api/v1/auth/refresh", tilePath]);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).credentials).toBe("same-origin");
      expect(new Headers((init as RequestInit).headers).get("Authorization")).toBeNull();
    }
    expect(currentSessionGeneration()).toBe(0);
  });
});
