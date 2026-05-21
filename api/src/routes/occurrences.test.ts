import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { dataRoutes } from "./occurrences";

vi.mock("ioredis", () => ({
  Redis: class MockRedis {
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
}));

describe("data routes", () => {
  const app = new Hono();
  app.route("/api/v1/data", dataRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /species", () => {
    it("returns paginated species list", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => Promise.resolve([
                  { id: "sp-1", name: "Species A", occurrenceCount: 10, createdAt: new Date() },
                  { id: "sp-2", name: "Species B", occurrenceCount: 20, createdAt: new Date() },
                ])),
              })),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => Promise.resolve([{ count: 2 }])),
        });

      const res = await app.request("/api/v1/data/species?page=1&limit=10");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.species).toHaveLength(2);
      expect(data.pagination.total).toBe(2);
    });

    it("uses default pagination", async () => {
      const { db } = await import("../db");
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => ({
                offset: vi.fn(() => Promise.resolve([])),
              })),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => Promise.resolve([{ count: 0 }])),
        });

      const res = await app.request("/api/v1/data/species");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pagination.limit).toBe(50);
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
            where: vi.fn(() => Promise.resolve([{ count: 1 }])),
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
