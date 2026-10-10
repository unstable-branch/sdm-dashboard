import maplibregl from "maplibre-gl";
import { apiGetArrayBuffer, assertSessionGenerationCurrent } from "@/services/api";
import { currentSessionGeneration } from "@/services/session-coordinator";

const TILE_TIMEOUT_MS = 15_000;
let nextScope = 0;

export interface AuthenticatedRasterTileScope {
  readonly protocol: string;
  readonly scopeId: string;
  readonly runId: string;
  readonly band: string;
  readonly tiles: readonly [string];
  dispose(): void;
}

function randomScopeId(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return `m${random ?? `${Date.now().toString(36)}${(++nextScope).toString(36)}`}`;
}

function parseOwnedTileUrl(
  rawUrl: string,
  protocol: string,
  scopeId: string,
  runId: string,
  band: string,
): string {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid authenticated raster tile URL"); }
  if (url.protocol !== `${protocol}:` || url.hostname !== scopeId || url.username || url.password || url.port || url.hash) {
    throw new Error("Raster tile URL is outside its map scope");
  }
  const parts = url.pathname.split("/");
  if (parts.length !== 9 || parts[0] !== "" || parts[1] !== "api" || parts[2] !== "v1" || parts[3] !== "results" || parts[4] !== "tiles") {
    throw new Error("Raster tile route is invalid");
  }
  let decodedRunId: string;
  try { decodedRunId = decodeURIComponent(parts[5]); } catch { throw new Error("Raster tile route is malformed"); }
  if (decodedRunId !== runId || !/^(0|[1-9]\d*)$/.test(parts[6]) || !/^(0|[1-9]\d*)$/.test(parts[7]) || !/^(0|[1-9]\d*)$/.test(parts[8])) {
    throw new Error("Raster tile identity or coordinates are invalid");
  }
  const z = Number(parts[6]);
  const x = Number(parts[7]);
  const y = Number(parts[8]);
  if (!Number.isSafeInteger(z) || z > 30 || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x >= 2 ** z || y >= 2 ** z) {
    throw new Error("Raster tile coordinates are out of range");
  }
  const params = [...url.searchParams.entries()];
  if (params.length !== 1 || params[0][0] !== "band" || params[0][1] !== band || /%(?![\da-f]{2})/i.test(url.search)) {
    throw new Error("Raster tile band is invalid");
  }
  return `${url.pathname}${url.search}`;
}

export function createAuthenticatedRasterTileScope({ runId, band }: { runId: string; band: string }): AuthenticatedRasterTileScope {
  if (!runId || !band || runId.includes("/") || !/^[^/?#]+$/.test(runId) || !/^[^&#]+$/.test(band)) {
    throw new Error("Raster tile identity is invalid");
  }
  const protocol = `sdm-results-${randomScopeId().toLowerCase()}`;
  const scopeId = randomScopeId();
  const sessionGeneration = currentSessionGeneration();
  let active = true;
  const inFlight = new Set<AbortController>();
  const tileTemplate = `/${"api/v1/results/tiles"}/${encodeURIComponent(runId)}/{z}/{x}/{y}?band=${encodeURIComponent(band)}`;
  const handler: maplibregl.AddProtocolAction = async (request, mapSignal) => {
    if (!active) throw new DOMException("Map tile scope is disposed", "AbortError");
    const url = parseOwnedTileUrl(request.url, protocol, scopeId, runId, band);
    assertSessionGenerationCurrent(sessionGeneration);
    const controller = new AbortController();
    inFlight.add(controller);
    const abort = () => controller.abort(mapSignal.signal.reason ?? new DOMException("Map tile request was aborted", "AbortError"));
    mapSignal.signal.addEventListener("abort", abort, { once: true });
    if (mapSignal.signal.aborted) abort();
    try {
      const data = await apiGetArrayBuffer(url, { signal: controller.signal, timeout: TILE_TIMEOUT_MS });
      if (!active || controller.signal.aborted) throw new DOMException("Map tile request is no longer current", "AbortError");
      assertSessionGenerationCurrent(sessionGeneration);
      return { data };
    } finally {
      mapSignal.signal.removeEventListener("abort", abort);
      inFlight.delete(controller);
    }
  };
  maplibregl.addProtocol(protocol, handler);
  return {
    protocol,
    scopeId,
    runId,
    band,
    tiles: [`${protocol}://${scopeId}${tileTemplate}`],
    dispose() {
      if (!active) return;
      active = false;
      for (const controller of inFlight) controller.abort(new DOMException("Map tile scope was disposed", "AbortError"));
      inFlight.clear();
      maplibregl.removeProtocol(protocol);
    },
  };
}
