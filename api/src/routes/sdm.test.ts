import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { sdmRunRoutes } from "./sdm-runs.js";
import { sdmBatchRoutes } from "./sdm-batch.js";
import { sdmTargetsRoutes } from "./sdm-targets.js";

const sdmRoutes = new Hono().route("/", sdmRunRoutes).route("/", sdmBatchRoutes).route("/", sdmTargetsRoutes);

const mockChain = (result: unknown) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          offset: vi.fn(() => Promise.resolve(result)),
        })),
      })),
    })),
  })),
});

const mockCountChain = (count: number) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => Promise.resolve([{ total: count }])),
  })),
});

const mockLimitChain = (result: unknown) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn(() => Promise.resolve(result)),
    })),
  })),
});

const buildRunPayloadConfig = {
  species: "Test species",
  modelId: "glm",
  biovars: [1, 4, 6, 12],
  projectionExtent: [-180, 180, -90, 90],
  backgroundN: 10000,
  cvFolds: 3,
  cvStrategy: "random",
  includeQuadratic: true,
  useElevation: false,
  elevationDemtype: "COP90",
  useSoil: false,
  soilVars: ["sand", "clay"],
  soilDepths: ["0-5cm", "30-60cm"],
  useUv: false,
  uvVars: ["UVB1"],
  useVegetation: false,
  vegYear: 2020,
  vegProducts: ["ndvi_annual_mean"],
  useLulc: false,
  lulcYear: 2020,
  useHfp: false,
  hfpYear: 2020,
  useBioclimSeason: false,
  useDrought: false,
  futureProjection: false,
  futureLabel: "Future climate",
  vifReduction: false,
  vifThreshold: 10,
  climateMatching: false,
  climateMatchingMethod: "mahalanobis",
  thinByCell: true,
  mergeSmallSources: true,
  minSourceRecords: 15,
  biasMethod: "uniform",
  thickeningDistanceKm: 10,
  paReplicates: 1,
  maxnetFeatures: "lq",
  maxnetRegmult: 1,
  aggregationFactor: 1,
  nCores: 1,
  seed: 42,
  worldclimDir: "Worldclim",
  worldclimRes: 10,
  source: "worldclim",
  analysisCrs: "auto",
  chelsaExtras: [],
  threshold: 0.5,
  maskType: "none",
  multiEnsembleModels: ["rf", "maxnet"],
  multiEnsembleWeighting: "equal",
  multiEnsemblePower: 2,
  multiEnsembleMinAuc: 0.7,
  multiEnsembleMinTss: 0.5,
  multiEnsembleExport: true,
  multiEnsembleUncertainty: true,
  biomod2Models: ["Biomod2"],
  droughtPeriods: ["annual_mean"],
  uvMonths: ["annual_mean"],
  esmMinAuc: 0.7,
  esmPower: 1,
  esmWeightingMetric: "AUC",
  esmBiovars: [1, 4],
  rangebagNBags: 100,
  rangebagBagFraction: 0.5,
  rangebagVarsPerBag: 1,
  maxnetAutoTune: false,
  rfNumTrees: 500,
  rfMinNodeSize: 10,
  gamK: 5,
  xgbMaxDepth: 6,
  xgbEta: 0.3,
  xgbNRounds: 100,
  dnnArchitecture: "DNN_Medium",
  dnnNSeeds: 5,
  dnnDevice: "auto",
  dnnDropout: 0.3,
  dnnL2Lambda: 0.001,
  dnnMultispeciesArchitecture: "DNN_Large",
  dnnMultispeciesNSeeds: 4,
  occurrenceFile: "/tmp/occurrences.csv",
};

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{}]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => [{}]) })) })),
  },
}));

vi.mock("../services/plumber", () => ({
  plumberClient: {
    getModelStatus: vi.fn(),
    runModel: vi.fn(async () => ({ job_id: "plumber-job-1" })),
    targetsRun: vi.fn(async () => ({ job_id: "targets-job-1" })),
  },
}));

vi.mock("../middleware/rate-limit", () => ({
  modelRateLimit: vi.fn(async (_c: any, next: any) => { await next(); }),
  rateLimit: vi.fn(() => vi.fn(async (_c: any, next: any) => { await next(); })),
  gbifRateLimit: vi.fn(async (_c: any, next: any) => { await next(); }),
  climateRateLimit: vi.fn(async (_c: any, next: any) => { await next(); }),
  defaultRateLimit: vi.fn(async (_c: any, next: any) => { await next(); }),
  authRateLimit: vi.fn(async (_c: any, next: any) => { await next(); }),
}));

vi.mock("ioredis", () => {
  class MockRedis {
    on = vi.fn();
    connect = vi.fn(() => Promise.resolve());
    zremrangebyscore = vi.fn(() => Promise.resolve(0));
    zcard = vi.fn(() => Promise.resolve(0));
    zadd = vi.fn(() => Promise.resolve(1));
    expire = vi.fn(() => Promise.resolve(1));
  }
  return { default: MockRedis, Redis: MockRedis };
});

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
  optionalAuth: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
}));

vi.mock("../services/access", () => ({
  ensureDefaultProject: vi.fn(async () => "proj-1"),
  getUserProjectIds: vi.fn(async () => ["proj-1"]),
}));

vi.mock("../services/queue", () => ({
  enqueueSdmJob: vi.fn(async () => "job-1"),
  getSharedRedis: vi.fn(() => null),
  getJobQueue: vi.fn(() => ({
    remove: vi.fn(async () => {}),
  })),
}));

vi.mock("hono/jwt", () => ({
  verify: vi.fn(async () => ({ sub: "user-1", email: "test@example.com", role: "admin" })),
}));

describe("SDM routes", () => {
  const app = new Hono();
  app.route("/api/v1/sdm", sdmRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /config/defaults", () => {
    it("includes multispecies DNN fallback defaults", async () => {
      const res = await app.request("/api/v1/sdm/config/defaults");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.dnnMultispeciesArchitecture).toBe("DNN_Medium");
      expect(data.dnnMultispeciesNSeeds).toBe(3);
    });
  });

  describe("GET /runs", () => {
    it("returns paginated runs", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce(mockChain([
          {
            id: "run-1",
            species: "Test species",
            model_id: "glm",
            status: "completed",
            started_at: new Date("2024-01-01"),
            completed_at: new Date("2024-01-01T01:00:00Z"),
            metrics: { auc_mean: 0.85 },
            error: null,
          },
        ]))
        .mockReturnValueOnce(mockCountChain(2));

      const res = await app.request("/api/v1/sdm/runs?page=1&limit=10");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.runs).toBeDefined();
      expect(data.runs).toHaveLength(1);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(10);
    });

    it("uses default pagination when no params", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce(mockChain([]))
        .mockReturnValueOnce(mockCountChain(0));

      const res = await app.request("/api/v1/sdm/runs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(20);
      expect(data.pagination.total).toBe(0);
    });
  });

  describe("GET /status/:jobId", () => {
    it("returns run status with config", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{
              id: "run-1",
              status: "completed",
              speciesName: "Test species",
              modelId: "glm",
              startedAt: new Date("2024-01-01"),
              completedAt: new Date("2024-01-01T01:00:00Z"),
              metrics: { auc_mean: 0.85 },
              outputFiles: { suitability_tif: "outputs/jobs/run-1/suitability.tif" },
              error: null,
              progressLog: ["Started", "Completed"],
              config: { threshold: 0.5, biovars: "1,4,6,12" },
              jobId: null,
            }])),
          })),
        })),
      });

      const res = await app.request("/api/v1/sdm/status/run-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config).toEqual({ threshold: 0.5, biovars: "1,4,6,12" });
    });

    it("returns 404 for missing run", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const res = await app.request("/api/v1/sdm/status/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /batch", () => {
    it("rejects empty configs", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configs: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects missing configs array", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /run", () => {
    it("uses buildModelPayload for async queue run payloads", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce(mockLimitChain([{ id: "species-1", projectId: "proj-1" }]))
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ maxNum: 7 }])),
          })),
        });

      (db.insert as any).mockImplementation(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "run-1" }]),
        })),
      }));

      const { enqueueSdmJob } = await import("../services/queue");
      const { plumberClient } = await import("../services/plumber");
      (plumberClient.runModel as any).mockClear();

      const res = await app.request("/api/v1/sdm/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildRunPayloadConfig, async: true }),
      });

      expect(res.status).toBe(200);
      expect((enqueueSdmJob as any).mock.calls).toHaveLength(1);

      const payload = (enqueueSdmJob as any).mock.calls[0][0].payload as Record<string, unknown>;
      expect(payload).toMatchObject({
        runId: "run-1",
        multi_ensemble_models: buildRunPayloadConfig.multiEnsembleModels,
        biomod2_models: buildRunPayloadConfig.biomod2Models,
        dnn_model_type: buildRunPayloadConfig.dnnArchitecture,
        dnn_lambda: buildRunPayloadConfig.dnnL2Lambda,
        dnn_multispecies_architecture: buildRunPayloadConfig.dnnMultispeciesArchitecture,
        dnn_multispecies_n_seeds: buildRunPayloadConfig.dnnMultispeciesNSeeds,
        xgb_nrounds: buildRunPayloadConfig.xgbNRounds,
        projection_extent: "-180,180,-90,90",
      });
      expect(payload.biovars).toBe("1,4,6,12");
      expect(payload.dnn_l2_lambda).toBeUndefined();
      expect(plumberClient.runModel).not.toHaveBeenCalled();
    });

    it("uses buildModelPayload for sync run payloads", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ maxNum: 7 }])),
          })),
        });

      (db.insert as any).mockImplementation(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "run-2" }]),
        })),
      }));

      const { plumberClient } = await import("../services/plumber");
      (plumberClient.runModel as any).mockClear();
      (plumberClient.runModel as any).mockResolvedValue({ job_id: "plumber-job-1" });

      const res = await app.request("/api/v1/sdm/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRunPayloadConfig),
      });

      expect(res.status).toBe(200);
      expect(plumberClient.runModel).toHaveBeenCalledTimes(1);

      const payload = (plumberClient.runModel as any).mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toMatchObject({
        multi_ensemble_models: buildRunPayloadConfig.multiEnsembleModels,
        biomod2_models: buildRunPayloadConfig.biomod2Models,
        dnn_model_type: buildRunPayloadConfig.dnnArchitecture,
        dnn_lambda: buildRunPayloadConfig.dnnL2Lambda,
        dnn_multispecies_architecture: buildRunPayloadConfig.dnnMultispeciesArchitecture,
        dnn_multispecies_n_seeds: buildRunPayloadConfig.dnnMultispeciesNSeeds,
        xgb_nrounds: buildRunPayloadConfig.xgbNRounds,
      });
      expect(payload.biovars).toBe("1,4,6,12");
      expect(payload.projection_extent).toBe("-180,180,-90,90");
      expect(payload.dnn_l2_lambda).toBeUndefined();
    });
  });

  describe("POST /batch run queue", () => {
    it("routes batch through targets pipeline", async () => {
      const { plumberClient } = await import("../services/plumber");
      (plumberClient.targetsRun as any).mockResolvedValueOnce({ job_id: "targets-job-1" });

      const { db } = await import("../db");
      (db.insert as any).mockImplementation(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "batch-1" }]),
        })),
        set: vi.fn(() => ({ where: vi.fn() })),
      }));

      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unit batch",
          configs: [{ ...buildRunPayloadConfig, species: "Batch species" }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.job_id).toBe("targets-job-1");
      expect(data.batch_id).toBe("batch-1");
    });
  });

  describe("POST /batch/cancel", () => {
    it("returns 404 for nonexistent batch", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      });
      const res = await app.request("/api/v1/sdm/batch/nonexistent/cancel", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /batch/retry", () => {
    it("returns 404 for nonexistent batch", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      });
      const res = await app.request("/api/v1/sdm/batch/nonexistent/retry", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Multi-species batch operations", () => {
    it("submits batch with 3 species configs", async () => {
      const { plumberClient } = await import("../services/plumber");
      (plumberClient.targetsRun as any).mockResolvedValueOnce({ job_id: "targets-3sp" });

      const { db } = await import("../db");
      (db.insert as any).mockImplementation(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "batch-ms-1" }]),
        })),
        set: vi.fn(() => ({ where: vi.fn() })),
      }));

      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Multi-species test",
          configs: [
            { ...buildRunPayloadConfig, species: "Species_North" },
            { ...buildRunPayloadConfig, species: "Species_East" },
            { ...buildRunPayloadConfig, species: "Species_West" },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.job_id).toBe("targets-3sp");
      expect(data.batch_id).toBe("batch-ms-1");
      expect(data.total).toBe(3);
    });

    it("passes all configs to plumber targetsRun", async () => {
      const { plumberClient } = await import("../services/plumber");
      (plumberClient.targetsRun as any).mockClear();
      (plumberClient.targetsRun as any).mockResolvedValueOnce({ job_id: "targets-check" });

      const { db } = await import("../db");
      (db.insert as any).mockImplementation(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "batch-check" }]),
        })),
        set: vi.fn(() => ({ where: vi.fn() })),
      }));

      const configs = [
        { ...buildRunPayloadConfig, species: "Sp1", modelId: "glm" },
        { ...buildRunPayloadConfig, species: "Sp2", modelId: "rangebag" },
      ];

      await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mixed models", configs }),
      });

      expect(plumberClient.targetsRun).toHaveBeenCalledTimes(1);
      const payload = (plumberClient.targetsRun as any).mock.calls[0][0] as Record<string, any>;
      expect(payload.configs).toHaveLength(2);
      expect(payload.configs[0].species).toBe("Sp1");
      expect(payload.configs[1].species).toBe("Sp2");
      expect(payload.configs[0].modelId).toBe("glm");
      expect(payload.configs[1].modelId).toBe("rangebag");
    });
  });

  describe("Batch config validation", () => {
    it("rejects batch over 50 configs", async () => {
      const manyConfigs = new Array(51).fill(null).map((_, i) => ({
        ...buildRunPayloadConfig,
        species: `Species_${i}`,
      }));

      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Too many", configs: manyConfigs }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects batch with missing species name", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: [{ ...buildRunPayloadConfig, species: "" }],
        }),
      });

      expect([400, 422, 500]).toContain(res.status);
    });

    it("rejects config with invalid projection extent", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: [{
            ...buildRunPayloadConfig,
            projectionExtent: [200, 300, -100, 100],
          }],
        }),
      });

      expect([400, 422, 500]).toContain(res.status);
    });

    it("rejects config with too few biovars", async () => {
      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: [{
            ...buildRunPayloadConfig,
            biovars: [1],
          }],
        }),
      });

      expect([400, 422, 500]).toContain(res.status);
    });

    it("accepts batch with exactly 50 configs", async () => {
      const { plumberClient } = await import("../services/plumber");
      (plumberClient.targetsRun as any).mockResolvedValueOnce({ job_id: "targets-50" });

      const { db } = await import("../db");
      (db.insert as any).mockImplementation(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "batch-50" }]),
        })),
        set: vi.fn(() => ({ where: vi.fn() })),
      }));

      const manyConfigs = new Array(50).fill(null).map((_, i) => ({
        ...buildRunPayloadConfig,
        species: `Species_${i}`,
      }));

      const res = await app.request("/api/v1/sdm/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Max batch", configs: manyConfigs }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(50);
    });
  });
});
