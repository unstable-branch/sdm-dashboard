import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlumberClient, plumberForPrincipal } from "./plumber.js";

describe("Plumber principal binding", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "running" }),
      text: async () => "",
      headers: new Headers(),
      requestHeaders: init?.headers,
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects a bare protected call without sending a request", async () => {
    await expect(new PlumberClient("http://plumber").getModelStatus("job-1"))
      .rejects.toThrow("Verified Plumber principal required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an immutable user and role principal", async () => {
    const client = plumberForPrincipal({ id: "user-a", role: "admin" }, "http://plumber");
    await client.getModelStatus("job-1");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Forwarded-User"]).toBe("user-a");
    expect(headers["X-Forwarded-Role"]).toBe("admin");
  });

  it("isolates concurrent principals", async () => {
    const seen: Array<[string | undefined, string | undefined]> = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seen.push([headers["X-Forwarded-User"], headers["X-Forwarded-Role"]]);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { ok: true, status: 200, json: async () => ({ status: "running" }) };
    });
    const a = plumberForPrincipal({ id: "user-a", role: "viewer" }, "http://plumber");
    const b = plumberForPrincipal({ id: "user-b", role: "editor" }, "http://plumber");
    await Promise.all([a.getModelStatus("job-a"), b.getModelStatus("job-b")]);
    expect(seen).toEqual(expect.arrayContaining([["user-a", "viewer"], ["user-b", "editor"]]));
  });

  it("keeps explicitly public discovery available on the public client", async () => {
    await new PlumberClient("http://plumber").getModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
