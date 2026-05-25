import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { dataRoutes } from "./occurrences.js";
import {
  createOccurrenceDataset,
  getOccurrenceDatasetForUser,
  listOccurrenceDatasets,
} from "../services/occurrence-datasets.js";
import type {
  CreateOccurrenceDatasetInput,
  OccurrenceDatasetAggregate,
} from "../services/occurrence-datasets.js";

vi.mock("ioredis", () => ({
  Redis: class MockRedis {
    on = vi.fn();
    connect = vi.fn(() => Promise.resolve());
    zremrangebyscore = vi.fn(() => Promise.resolve(0));
    zcard = vi.fn(() => Promise.resolve(0));
    zadd = vi.fn(() => Promise.resolve(1));
    expire = vi.fn(() => Promise.resolve(1));
  },
}));

vi.mock("../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: "sp-1", name: "Test species", occurrenceCount: 0 }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve({})),
      })),
    })),
  },
}));

vi.mock("../services/plumber", () => {
  const userClient = {
    uploadOccurrence: vi.fn(() => Promise.resolve({ file_id: "/tmp/test.csv", n_rows: 10 })),
    parseDwca: vi.fn(() => Promise.resolve({ file_id: "/tmp/test-dwca.csv", n_rows: 10 })),
  };

  return {
    plumberClient: {
      ...userClient,
      withUser: vi.fn(() => userClient),
      cleanOccurrences: vi.fn(() => Promise.resolve({ cleaned_id: "/tmp/test.csv", valid_records: 8 })),
      searchGbif: vi.fn(() => Promise.resolve({ n_records: 50 })),
    },
  };
});

vi.mock("../services/occurrence-datasets", () => ({
  createOccurrenceDataset: vi.fn(),
  getOccurrenceDatasetForUser: vi.fn(),
  listOccurrenceDatasets: vi.fn(),
}));

vi.mock("../services/queue", () => ({
  enqueueSdmJob: vi.fn(() => Promise.resolve("job-123")),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(() => "longitude,latitude\n1,2\n3,4"),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  accessSync: vi.fn(),
  constants: { W_OK: 2 },
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "admin" });
    await next();
  }),
}));

vi.mock("../services/access", () => ({
  ensureDefaultProject: vi.fn(async () => "proj-1"),
  getUserProjectIds: vi.fn(async () => null),
}));

function datasetFixture(overrides: Partial<OccurrenceDatasetAggregate> = {}): OccurrenceDatasetAggregate {
  return {
    id: "ds-1",
    projectId: "proj-1",
    speciesId: "sp-1",
    parentDatasetId: null,
    kind: "upload",
    status: "ready",
    fileId: "/tmp/test.csv",
    fileName: "test.csv",
    recordCount: 10,
    validCount: null,
    summary: null,
    metadata: null,
    createdBy: "user-1",
    createdAt: new Date("2026-05-25T00:00:00Z"),
    updatedAt: new Date("2026-05-25T00:00:00Z"),
    ...overrides,
  };
}

describe("data routes", () => {
  const app = new Hono();
  app.route("/api/v1/data", dataRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOccurrenceDataset).mockImplementation(async (input: CreateOccurrenceDatasetInput) => datasetFixture({
      id: "ds-created",
      projectId: input.projectId,
      speciesId: input.speciesId ?? null,
      parentDatasetId: input.parentDatasetId ?? null,
      kind: input.kind,
      status: input.status ?? "pending",
      fileId: input.fileId,
      fileName: input.fileName ?? null,
      recordCount: input.recordCount ?? null,
      validCount: input.validCount ?? null,
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
      createdBy: input.createdBy ?? null,
    }));
    vi.mocked(listOccurrenceDatasets).mockResolvedValue([datasetFixture()]);
    vi.mocked(getOccurrenceDatasetForUser).mockResolvedValue(datasetFixture());
  });

  describe("occurrence dataset identity", () => {
    it("lists datasets with query filters", async () => {
      const res = await app.request(
        "/api/v1/data/occurrence-datasets?project_id=proj-1&species_id=sp-1&kind=upload&status=ready&limit=25&offset=5"
      );

      expect(res.status).toBe(200);
      expect(listOccurrenceDatasets).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "proj-1",
        speciesId: "sp-1",
        kind: "upload",
        status: "ready",
        limit: 25,
        offset: 5,
      }));
      const data = await res.json();
      expect(data.occurrence_datasets).toHaveLength(1);
      expect(data.occurrence_datasets[0].id).toBe("ds-1");
    });

    it("registers an existing file as a dataset", async () => {
      const res = await app.request("/api/v1/data/occurrence-datasets/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path: "/data/source.csv",
          species_id: "sp-1",
          file_name: "source.csv",
          record_count: 12,
        }),
      });

      expect(res.status).toBe(201);
      expect(createOccurrenceDataset).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "proj-1",
        speciesId: "sp-1",
        kind: "registered",
        status: "ready",
        fileId: "/data/source.csv",
        fileName: "source.csv",
        recordCount: 12,
        createdBy: "user-1",
      }));
      const data = await res.json();
      expect(data.id).toBe("ds-created");
    });

    it("fetches a visible dataset by id", async () => {
      const res = await app.request("/api/v1/data/occurrence-datasets/ds-1?project_id=proj-1");

      expect(res.status).toBe(200);
      expect(getOccurrenceDatasetForUser).toHaveBeenCalledWith(expect.objectContaining({
        datasetId: "ds-1",
        userId: "user-1",
        userRole: "admin",
        projectId: "proj-1",
      }));
      const data = await res.json();
      expect(data.id).toBe("ds-1");
    });
  });

  describe("POST /occurrences/upload", () => {
    it("returns a dataset_id when Plumber returns a file id", async () => {
      const form = new FormData();
      form.set("file", new File(["longitude,latitude\n1,2\n"], "test.csv", { type: "text/csv" }));

      const res = await app.request("/api/v1/data/occurrences/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status).toBe(200);
      expect(createOccurrenceDataset).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "proj-1",
        kind: "upload",
        status: "ready",
        fileId: "/tmp/test.csv",
        fileName: "test.csv",
        recordCount: 10,
      }));
      const data = await res.json();
      expect(data.file_id).toBe("/tmp/test.csv");
      expect(data.dataset_id).toBe("ds-created");
    });
  });

  describe("GET /species", () => {
    it("returns species list", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([
                { id: "sp-1", name: "Species A", occurrenceCount: 10, createdAt: new Date() },
                { id: "sp-2", name: "Species B", occurrenceCount: 20, createdAt: new Date() },
              ])),
            })),
          })),
        });

      const res = await app.request("/api/v1/data/species?limit=10");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.species).toHaveLength(2);
      expect(data.hasMore).toBe(false);
    });

    it("uses default limit", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
        });

      const res = await app.request("/api/v1/data/species");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.species).toEqual([]);
      expect(data.hasMore).toBe(false);
    });
  });

  describe("GET /species/:id", () => {
    it("returns single species", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([
              { id: "sp-1", name: "Test species", occurrenceCount: 15, createdAt: new Date() },
            ])),
          })),
        })),
      });

      const res = await app.request("/api/v1/data/species/sp-1");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("sp-1");
    });

    it("returns 404 for missing species", async () => {
      const { db } = await import("../db");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const res = await app.request("/api/v1/data/species/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /species/:id/occurrences", () => {
    it("returns paginated occurrences", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([{ id: "sp-1" }])),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => Promise.resolve([
                  { id: "occ-1", speciesId: "sp-1", longitude: 10, latitude: -20 },
                ])),
              })),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([{ total: 1 }])),
          })),
        });

      const res = await app.request("/api/v1/data/species/sp-1/occurrences?page=1&limit=10");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.occurrences).toHaveLength(1);
      expect(data.pagination.total).toBe(1);
    });
  });
});
