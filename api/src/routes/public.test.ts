import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Hono } from "hono";
import { normalizeSpeciesIntelligenceFromRun, publicRoutes } from "./public.js";

let redisCallCount = 0;
vi.mock("ioredis", () => ({
  default: class {
    on = vi.fn();
    connect = vi.fn(() => Promise.resolve());
    get status() { return "ready"; }
    zremrangebyscore = vi.fn(() => Promise.resolve(0));
    zcard = vi.fn(() => Promise.resolve(redisCallCount));
    zadd = vi.fn(() => { redisCallCount++; return Promise.resolve(1); });
    expire = vi.fn(() => Promise.resolve(1));
  },
}));

type NormalizerInput = Parameters<typeof normalizeSpeciesIntelligenceFromRun>[0];
type NormalizerRun = NonNullable<NormalizerInput["run"]>;

function mockRunQuery(result: unknown) {
  return {
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => result),
          })),
        })),
      })),
    })),
  };
}

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../middleware/auth", () => ({
  optionalAuth: vi.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

async function mockSelectedRuns(rows: NormalizerRun[]) {
  const { db } = await import("../db");
  (db.select as unknown as Mock).mockReturnValue(mockRunQuery(rows));
}

function expectPublicSpeciesContract(data: Record<string, unknown>) {
  expect(data).not.toHaveProperty("projectId");
  expect(data).not.toHaveProperty("project_id");
  expect(data).not.toHaveProperty("uploadId");
  expect(data).not.toHaveProperty("jobId");
  expect(data).not.toHaveProperty("filePath");
  expect(data).not.toHaveProperty("localPath");
  expect(data).not.toHaveProperty("runLog");
  expect(data).not.toHaveProperty("progressLog");
  expect(data).not.toHaveProperty("provenance");
  expect(data).not.toHaveProperty("outputFiles");
  expect(data).not.toHaveProperty("config");
}

describe("public species-intelligence", () => {
  const app = new Hono();
  app.route("/api/v1/public", publicRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    redisCallCount = 0;
  });

  it("returns a safe fallback when no completed run is available", async () => {
    await mockSelectedRuns([]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=red-rabbit&scientific_name=Poecile%20montanus",
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.occurrenceSource).toBe("ala");
    expect(data.modelStatus).toBe("unavailable");
    expect(data.occurrenceCount).toBe(0);
    expect(data.nativeRangeBioregions).toEqual([]);
    expect(data.suitabilityTileUrl).toBeNull();
    expect(data.suitabilityImageUrl).toBeNull();
    expect(data.sourceRunId).toBeNull();
  });

  it("maps completed run fields into the SpeciesIntelligence contract", async () => {
    const run = {
      runId: "run-123",
      status: "completed",
      completedAt: new Date("2026-01-02T12:00:00.000Z"),
      config: { projectionExtent: [1, 2, 3, 4], ala_guid: "ABC-001" },
      metrics: {
        occurrence_count: 42,
      },
      outputFiles: {
        suitability_tile_url: "https://cdn.example/suitability/123/tile/{z}/{x}/{y}.png",
        suitability_image_url: "https://cdn.example/suitability/123/preview.png",
        native_range_bioregions: ["NSW", "VIC"],
      },
      provenance: {
        nativeRangeBioregions: ["NSW", "VIC", "QLD"],
        confidenceLabel: "Moderate confidence",
        limitations: ["Small sample size", "Climate uncertainty"],
        futureClimateSummary: "Minimal change expected by 2050",
        recommendedUse: "Best for reference only",
      },
      speciesOccurrenceCount: 9,
    } satisfies NormalizerRun;

    await mockSelectedRuns([run]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=my-seed&scientific_name=Poecile%20montanus&customer_bioregion=NSW&ala_guid=abc-001",
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.occurrenceCount).toBe(42);
    expect(data.occurrenceSource).toBe("sdm-dashboard");
    expect(data.alaGuid).toBe("abc-001");
    expect(data.modelStatus).toBe("ready");
    expect(data.nativeRangeBioregions).toEqual(["NSW", "VIC", "QLD"]);
    expect(data.customerBioregionMatch).toBe("match");
    expect(data.suitabilityTileUrl).toBe(
      "https://cdn.example/suitability/123/tile/{z}/{x}/{y}.png",
    );
    expect(data.suitabilityImageUrl).toBe("https://cdn.example/suitability/123/preview.png");
    expect(data.confidenceLabel).toBe("Moderate confidence");
    expect(data.futureClimateSummary).toBe("Minimal change expected by 2050");
    expect(data.recommendedUse).toBe("Best for reference only");
    expect(data.limitations).toEqual(["Small sample size", "Climate uncertainty"]);
    expect(data.sourceRunId).toBe("run-123");
    expect(data.lastModelRunAt).toBe("2026-01-02T12:00:00.000Z");
    expectPublicSpeciesContract(data);
  });

  it("returns stale completed-run data when a newer active run is in progress", async () => {
    const activeRun = {
      runId: "run-active",
      status: "running",
      completedAt: null,
      config: { ala_guid: "ABC-001" },
      metrics: {},
      outputFiles: {},
      provenance: {},
      speciesOccurrenceCount: null,
    } satisfies NormalizerRun;
    const completedRun = {
      runId: "run-completed",
      status: "completed",
      completedAt: new Date("2026-01-02T12:00:00.000Z"),
      config: { ala_guid: "ABC-001" },
      metrics: { occurrence_count: 22 },
      outputFiles: {
        suitability_tile_url: "https://cdn.example/suitability/old/tile/{z}/{x}/{y}.png",
      },
      provenance: {
        nativeRangeBioregions: ["Sydney Basin"],
        confidenceLabel: "Moderate confidence",
      },
      speciesOccurrenceCount: 22,
    } satisfies NormalizerRun;

    await mockSelectedRuns([activeRun, completedRun]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=seed-stale&scientific_name=Acacia%20dealbata&ala_guid=ABC-001",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    const data = await res.json();
    expect(data.modelStatus).toBe("stale");
    expect(data.occurrenceSource).toBe("sdm-dashboard");
    expect(data.occurrenceCount).toBe(22);
    expect(data.sourceRunId).toBe("run-completed");
    expect(data.suitabilityTileUrl).toBe("https://cdn.example/suitability/old/tile/{z}/{x}/{y}.png");
    expectPublicSpeciesContract(data);
  });

  it("returns processing when only active run data is available", async () => {
    const activeRun = {
      runId: "run-active-only",
      status: "queued",
      completedAt: null,
      config: { ala_guid: "ABC-002" },
      metrics: {},
      outputFiles: {},
      provenance: {},
      speciesOccurrenceCount: null,
    } satisfies NormalizerRun;

    await mockSelectedRuns([activeRun]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=seed-processing&scientific_name=Acacia%20dealbata&ala_guid=ABC-002",
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.modelStatus).toBe("processing");
    expect(data.occurrenceSource).toBe("ala");
    expect(data.sourceRunId).toBe("run-active-only");
    expectPublicSpeciesContract(data);
  });

  it("returns the stored run ALA GUID when Twig does not provide one", () => {
    const data = normalizeSpeciesIntelligenceFromRun({
      seedSlug: "seed-abc",
      scientificName: "Test species",
      alaGuid: null,
      customerBioregion: null,
      run: {
        runId: "run-with-guid",
        status: "completed",
        completedAt: new Date("2026-01-02T12:00:00.000Z"),
        config: { ala_guid: "ALA-123" },
        metrics: {},
        outputFiles: {},
        provenance: {},
        speciesOccurrenceCount: null,
      },
    });

    expect(data.alaGuid).toBe("ALA-123");
  });

  it("falls back to safe defaults when supplied URLs are not public-safe", async () => {
    const run = {
      runId: "run-456",
      status: "completed",
      completedAt: new Date("2026-01-02T12:00:00.000Z"),
      config: {},
      metrics: { presence_records: 3 },
      outputFiles: {
        suitability_tile_url: "/tmp/local/output.tif",
        suitability_image_url: "file:///tmp/local/preview.png",
      },
      provenance: {},
      speciesOccurrenceCount: 3,
    } satisfies NormalizerRun;

    await mockSelectedRuns([run]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=seed-2&scientific_name=Acacia%20robusta",
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.suitabilityTileUrl).toBeNull();
    expect(data.suitabilityImageUrl).toBeNull();
    expect(JSON.stringify(data)).not.toContain("/tmp/local");
    expect(JSON.stringify(data)).not.toContain("file://");
  });

  it("does not expose internal run metadata or private artifact paths", async () => {
    const run = {
      runId: "run-redacted",
      status: "completed",
      completedAt: new Date("2026-01-02T12:00:00.000Z"),
      config: {
        projectId: "project-private",
        localPath: "/srv/sdm/private/config.json",
        progressLog: ["internal config loaded"],
        suitability_tile_url: "private://runs/run-redacted/tile",
      },
      metrics: { occurrence_count: 7 },
      outputFiles: {
        project_id: "project-private",
        filePath: "/srv/sdm/private/output.tif",
        runLog: ["internal output line"],
        suitability_tile_url: "http://localhost:9000/internal/tile/{z}/{x}/{y}.png",
        suitability_image_url: "https://cdn.example/public/preview.png",
      },
      provenance: {
        localPath: "/tmp/private/provenance.json",
        progressLog: ["private progress"],
        limitations: ["Public caveat only"],
      },
      speciesOccurrenceCount: 7,
    } satisfies NormalizerRun;

    await mockSelectedRuns([run]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=seed-redacted&scientific_name=Acacia%20dealbata",
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.suitabilityTileUrl).toBeNull();
    expect(data.suitabilityImageUrl).toBe("https://cdn.example/public/preview.png");
    expect(data.limitations).toEqual(["Public caveat only"]);
    expectPublicSpeciesContract(data);
    expect(JSON.stringify(data)).not.toContain("project-private");
    expect(JSON.stringify(data)).not.toContain("/srv/sdm/private");
    expect(JSON.stringify(data)).not.toContain("/tmp/private");
    expect(JSON.stringify(data)).not.toContain("private://");
    expect(JSON.stringify(data)).not.toContain("localhost");
    expect(JSON.stringify(data)).not.toContain("internal output line");
  });

  it("returns a fallback when ala_guid is supplied but does not match any selected completed run", async () => {
    const run = {
      runId: "run-789",
      status: "completed",
      completedAt: new Date("2026-01-02T12:00:00.000Z"),
      config: { ala_guid: "ABC-001" },
      metrics: { occurrence_count: 12 },
      outputFiles: {
        suitability_tile_url: "https://cdn.example/suitability/456/tile/{z}/{x}/{y}.png",
      },
      provenance: {},
      speciesOccurrenceCount: 12,
    } satisfies NormalizerRun;

    await mockSelectedRuns([run]);

    const res = await app.request(
      "/api/v1/public/species-intelligence?seed_slug=seed-3&scientific_name=Acacia%20confusa&ala_guid=missing-guid",
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.occurrenceSource).toBe("ala");
    expect(data.modelStatus).toBe("unavailable");
    expect(data.occurrenceCount).toBe(0);
    expect(data.sourceRunId).toBeNull();
  });

  it("sets public cache headers and rate limits repeated endpoint calls", async () => {
    await mockSelectedRuns([]);
    const path =
      "/api/v1/public/species-intelligence?seed_slug=rate-limit-seed&scientific_name=Acacia%20rate";

    const first = await app.request(path);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toContain("public");
    expect(first.headers.get("Cache-Control")).toContain("s-maxage=300");

    let last = first;
    for (let i = 0; i < 60; i++) {
      last = await app.request(path);
    }

    expect(last.status).toBe(429);
  });

  it("normalizes fallback model response from helper", () => {
    expect(
      normalizeSpeciesIntelligenceFromRun({
        seedSlug: "seed-abc",
        scientificName: "Test species",
        alaGuid: null,
        customerBioregion: "ACT",
        run: null,
      }),
    ).toEqual({
      seedSlug: "seed-abc",
      scientificName: "Test species",
      alaGuid: null,
      occurrenceCount: 0,
      occurrenceSource: "ala",
      nativeRangeBioregions: [],
      customerBioregionMatch: "unknown",
      lastModelRunAt: null,
      modelStatus: "unavailable",
      suitabilityTileUrl: null,
      suitabilityImageUrl: null,
      confidenceLabel: null,
      limitations: [],
      futureClimateSummary: null,
      recommendedUse: null,
      sourceRunId: null,
    });
  });
});
