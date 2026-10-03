import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedRasterTileScope } from "./authenticated-raster-protocol";

const { apiGetArrayBuffer, addProtocol, removeProtocol, generation } = vi.hoisted(() => ({
  apiGetArrayBuffer: vi.fn(),
  addProtocol: vi.fn(),
  removeProtocol: vi.fn(),
  generation: { current: 4 },
}));

vi.mock("@/services/api", () => ({
  apiGetArrayBuffer,
  assertSessionGenerationCurrent: (value: number) => {
    if (value !== generation.current) throw new Error("stale session");
  },
}));
vi.mock("@/services/session-coordinator", () => ({
  currentSessionGeneration: () => generation.current,
}));
vi.mock("maplibre-gl", () => ({
  default: { addProtocol, removeProtocol },
}));

function protocolHandler() {
  const registration = addProtocol.mock.calls.at(-1);
  expect(registration).toBeDefined();
  return registration![1] as (params: { url: string }, controller: AbortController) => Promise<{ data: ArrayBuffer }>;
}

const bytes = new Uint8Array([137, 80, 78, 71]).buffer;

beforeEach(() => {
  vi.clearAllMocks();
  generation.current = 4;
  apiGetArrayBuffer.mockResolvedValue(bytes);
});
afterEach(() => vi.restoreAllMocks());

describe("authenticated MapLibre raster protocol", () => {
  it("loads only the owned same-origin route as bounded authenticated bytes", async () => {
    const scope = createAuthenticatedRasterTileScope({ runId: "run-7", band: "suitability" });
    const handler = protocolHandler();
    const result = await handler({ url: `${scope.protocol}://${scope.scopeId}/api/v1/results/tiles/run-7/3/4/5?band=suitability` }, new AbortController());
    expect(result.data).toBe(bytes);
    expect(apiGetArrayBuffer).toHaveBeenCalledWith("/api/v1/results/tiles/run-7/3/4/5?band=suitability", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    scope.dispose();
  });

  it.each([
    ["https://attacker.invalid/api/v1/results/tiles/run-7/3/4/5?band=suitability", "foreign origin"],
    ["sdm-results://other-scope/api/v1/results/tiles/run-7/3/4/5?band=suitability", "foreign scope"],
    ["sdm-results://scope/api/v1/results/tiles/other-run/3/4/5?band=suitability", "foreign run"],
    ["sdm-results://scope/api/v1/results/tiles/run-7/3/4/5?band=other", "foreign band"],
    ["sdm-results://scope/api/v1/results/tiles/run-7/3/4/5?band=suitability&next=https://attacker.invalid", "extra route parameter"],
    ["sdm-results://scope/api/v1/results/tiles/run-7/3/4/5?band=suitability%26x%3D1", "malformed route encoding"],
  ])("rejects %s before making a network request", async (url) => {
    const scope = createAuthenticatedRasterTileScope({ runId: "run-7", band: "suitability" });
    await expect(protocolHandler()({ url }, new AbortController())).rejects.toThrow();
    expect(apiGetArrayBuffer).not.toHaveBeenCalled();
    scope.dispose();
  });

  it("uses MapLibre cancellation and rejects stale generation after the body resolves", async () => {
    const scope = createAuthenticatedRasterTileScope({ runId: "run-7", band: "suitability" });
    const handler = protocolHandler();
    const controller = new AbortController();
    const pending = handler({ url: `${scope.protocol}://${scope.scopeId}/api/v1/results/tiles/run-7/3/4/5?band=suitability` }, controller);
    expect(apiGetArrayBuffer.mock.calls[0][1].signal).not.toBe(controller.signal);
    controller.abort();
    expect(apiGetArrayBuffer.mock.calls[0][1].signal.aborted).toBe(true);
    generation.current++;
    await expect(pending).rejects.toThrow();
    scope.dispose();
  });

  it("does not let one map dispose another map's protocol owner", async () => {
    const first = createAuthenticatedRasterTileScope({ runId: "run-7", band: "suitability" });
    const firstHandler = protocolHandler();
    const second = createAuthenticatedRasterTileScope({ runId: "run-8", band: "future" });
    const secondHandler = protocolHandler();
    expect(first.protocol).not.toBe(second.protocol);
    first.dispose();
    expect(removeProtocol).toHaveBeenCalledWith(first.protocol);
    expect(removeProtocol).not.toHaveBeenCalledWith(second.protocol);
    const result = await secondHandler({ url: `${second.protocol}://${second.scopeId}/api/v1/results/tiles/run-8/3/4/5?band=future` }, new AbortController());
    expect(result.data).toBe(bytes);
    expect(firstHandler).toBeDefined();
    second.dispose();
  });

  it("rejects a response that resolves after its map scope is disposed", async () => {
    let resolveBody!: (value: ArrayBuffer) => void;
    apiGetArrayBuffer.mockImplementation(() => new Promise<ArrayBuffer>((resolve) => { resolveBody = resolve; }));
    const scope = createAuthenticatedRasterTileScope({ runId: "run-7", band: "suitability" });
    const pending = protocolHandler()({ url: `${scope.protocol}://${scope.scopeId}/api/v1/results/tiles/run-7/3/4/5?band=suitability` }, new AbortController());
    scope.dispose();
    resolveBody(bytes);
    await expect(pending).rejects.toThrow();
  });
});
