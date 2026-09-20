import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
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

  it("requires a principal for manifest-publishing climate discovery", async () => {
    const client = new PlumberClient("http://plumber");
    await expect(client.getClimateScenarios()).rejects.toThrow("Verified Plumber principal required");
    await expect(client.getFutureScenarios()).rejects.toThrow("Verified Plumber principal required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an immutable user and role principal", async () => {
    const client = plumberForPrincipal({ id: "user-a", role: "admin" }, "http://plumber");
    await client.getModelStatus("job-1");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Forwarded-User"]).toBe("user-a");
    expect(headers["X-Forwarded-Role"]).toBe("admin");
  });

  it("attests canonical model payloads with a dedicated execution key", async () => {
    vi.stubEnv("PLUMBER_EXECUTION_KEY", "execution-secret");
    const payload = { occurrence_file: "/app/data/uploads/occ.csv", worldclim_dir: "/app/Worldclim" };
    const client = plumberForPrincipal({ id: "user-a", role: "editor" }, "http://plumber");

    await client.runModel(payload);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const body = fetchMock.mock.calls[0][1].body as string;
    const timestamp = headers["X-SDM-Execution-Timestamp"];
    const nonce = headers["X-SDM-Execution-Nonce"];
    expect(timestamp).toMatch(/^\d+$/);
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["X-SDM-Execution-Signature"]).toBe(
      createHmac("sha256", "execution-secret").update(`${timestamp}\n${nonce}\nuser-a\n${body}`).digest("hex"),
    );
  });

  it("does not retry an attested model submission after a retryable response", async () => {
    vi.stubEnv("PLUMBER_EXECUTION_KEY", "execution-secret");
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "temporarily unavailable" }),
      text: async () => "temporarily unavailable",
    }));
    const client = plumberForPrincipal({ id: "user-a", role: "editor" }, "http://plumber");

    await expect(client.runModel({ species: "Test", model_id: "glm" })).rejects.toThrow("temporarily unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an attested Targets submission after a retryable response", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "temporarily unavailable" }),
      text: async () => "temporarily unavailable",
    }));
    const client = plumberForPrincipal({ id: "user-a", role: "editor" }, "http://plumber");

    await expect(client.targetsRun({ configs: [{ species: "Test" }] })).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attests canonical Targets payloads with the dedicated execution key", async () => {
    vi.stubEnv("PLUMBER_EXECUTION_KEY", "execution-secret");
    const client = plumberForPrincipal({ id: "user-a", role: "editor" }, "http://plumber");

    await client.targetsRun({ configs: [{ species: "Test", model_id: "glm" }] });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const body = fetchMock.mock.calls[0][1].body as string;
    const timestamp = headers["X-SDM-Execution-Timestamp"];
    const nonce = headers["X-SDM-Execution-Nonce"];
    expect(headers["X-SDM-Execution-Signature"]).toBe(
      createHmac("sha256", "execution-secret").update(`${timestamp}\n${nonce}\nuser-a\n${body}`).digest("hex"),
    );
  });

  it("retains retries for idempotent model status polling", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({ error: "retry" }), text: async () => "retry" };
      }
      return { ok: true, status: 200, json: async () => ({ status: "running" }), text: async () => "" };
    });
    const client = plumberForPrincipal({ id: "user-a", role: "editor" }, "http://plumber");

    await expect(client.getModelStatus("job-1")).resolves.toEqual({ status: "running" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
