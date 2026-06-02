import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { dataRoutes } from "./occurrences.js";

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

vi.mock("../services/plumber", () => ({
  plumberClient: {
    withUser: vi.fn(function(this: any) {
      return this;
    }),
    uploadOccurrence: vi.fn(() => Promise.resolve({ file_id: "/tmp/test.csv", n_rows: 10 })),
    cleanOccurrences: vi.fn(() => Promise.resolve({ cleaned_id: "/tmp/test.csv", valid_records: 8 })),
    searchGbif: vi.fn(() => Promise.resolve({ n_records: 50 })),
  },
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
  promises: {
    writeFile: vi.fn(() => Promise.resolve()),
  },
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

describe("data routes", () => {
  const app = new Hono();
  app.route("/api/v1/data", dataRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /occurrences/upload", () => {
    it("normalizes Plumber upload file_id into file_path for the frontend", async () => {
      const { db } = await import("../db");
      const { plumberClient } = await import("../services/plumber");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([
              { used: 0, quota: 1024 * 1024 },
            ])),
          })),
        })),
      });
      (plumberClient.uploadOccurrence as any).mockResolvedValueOnce({
        file_id: "/app/data/uploads/test.csv",
        n_rows: 2,
      });

      const form = new FormData();
      form.append("file", new File(["longitude,latitude\n1,2\n3,4"], "test.csv", { type: "text/csv" }));

      const res = await app.request("/api/v1/data/occurrences/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status, await res.clone().text()).toBe(200);
      const data = await res.json();
      expect(data.file_id).toBe("/app/data/uploads/test.csv");
      expect(data.file_path).toBe("/app/data/uploads/test.csv");
    });

    it("returns Plumber upload errors without counting storage usage", async () => {
      const { db } = await import("../db");
      const { plumberClient } = await import("../services/plumber");
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([
              { used: 0, quota: 1024 * 1024 },
            ])),
          })),
        })),
      });
      (plumberClient.uploadOccurrence as any).mockResolvedValueOnce({
        error: "CSV is missing required coordinate columns",
      });

      const form = new FormData();
      form.append("file", new File(["name\nAcacia"], "bad.csv", { type: "text/csv" }));

      const res = await app.request("/api/v1/data/occurrences/upload", {
        method: "POST",
        body: form,
      });

      expect(res.status, await res.clone().text()).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("CSV is missing required coordinate columns");
      expect(db.update).not.toHaveBeenCalled();
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
