import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { dataRoutes } from "./occurrences.js";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "user-a", email: "[EMAIL]", role: "user" },
  projectIds: ["proj-1"],
  uploadedFilesRows: [] as Array<Record<string, unknown>>,
  uploadsRows: [] as Array<Record<string, unknown>>,
  storageUsedBytes: 0,
}));

vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", mocks.currentUser);
    await next();
  }),
  optionalAuth: vi.fn(async (_c: any, next: any) => await next()),
}));

vi.mock("../services/access.js", () => ({
  getUserProjectIds: vi.fn(async () => mocks.projectIds),
}));

vi.mock("../services/upload-utils.js", () => ({
  setUploadDir: vi.fn(),
  saveUploadEncrypted: vi.fn(() => Promise.resolve("/tmp/foo.enc")),
  decryptToUploads: vi.fn(),
  resolveFilePath: vi.fn((id: string) => ({ path: id, valid: true })),
  pollPlumberJob: vi.fn(),
}));

vi.mock("../services/encryption.js", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
}));

let lastUpdateWhere: any = null;
let lastUpdateSet: any = null;
let lastDeleteWhere: any = null;

vi.mock("../db/index.js", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: any) => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              if (table && table._name === "uploaded_files") return mocks.uploadedFilesRows[0] ? [mocks.uploadedFilesRows[0]] : [];
              if (table && table._name === "uploads") return mocks.uploadsRows[0] ? [mocks.uploadsRows[0]] : [];
              return [];
            }),
          })),
        })),
      })),
      update: vi.fn((table: any) => ({
        set: vi.fn((set: any) => ({
          where: vi.fn((where: any) => {
            lastUpdateSet = set;
            lastUpdateWhere = where;
            return Promise.resolve();
          }),
        })),
      })),
      delete: vi.fn((table: any) => ({
        where: vi.fn((where: any) => {
          lastDeleteWhere = where;
          return Promise.resolve();
        }),
      })),
    },
  };
});

vi.mock("../db/schema.js", () => {
  const mkTable = (name: string) => ({ _name: name, name });
  return {
    species: mkTable("species"),
    occurrences: mkTable("occurrences"),
    users: mkTable("users"),
    uploadedFiles: mkTable("uploaded_files"),
    uploads: mkTable("uploads"),
  };
});

vi.mock("../services/plumber.js", () => ({
  plumberClient: {
    withUser: vi.fn(() => ({
      getUploads: vi.fn(async (limit: number) => ({ uploads: mocks.uploadsRows.slice(0, limit) })),
    })),
  },
}));

vi.mock("../services/audit.js", () => ({
  logAction: vi.fn(() => Promise.resolve()),
  extractClientInfo: vi.fn(() => ({})),
}));

vi.mock("../middleware/rate-limit.js", () => ({
  defaultRateLimit: vi.fn(async (_c: any, next: any) => await next()),
}));

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  rmSync: vi.fn(),
  accessSync: vi.fn(),
  constants: { X_OK: 0 },
  promises: { readFile: vi.fn(async () => "") },
}));

function testApp() {
  const app = new Hono();
  app.route("/api/v1/data", dataRoutes);
  return app;
}

describe("GC-02: PATCH /uploads adds userId filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = { id: "user-a", email: "[EMAIL]", role: "user" };
    mocks.uploadedFilesRows = [];
    mocks.uploadsRows = [];
    lastUpdateWhere = null;
    lastUpdateSet = null;
  });

  it("writes uploads update with eq(uploads.userId, user.id)", async () => {
    mocks.uploadedFilesRows = [{ id: "uf-1", filePath: "/data/uploads/foo.csv", projectId: "proj-1" }];
    const app = testApp();
    const res = await app.request("/api/v1/data/uploads/foo.csv", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleaned: true, cleaned_valid_records: 100, cleaned_original_rows: 100 }),
    });
    expect(res.status).toBe(200);
    expect(lastUpdateWhere).toBeTruthy();
    const dumped = JSON.stringify(lastUpdateWhere);
    expect(dumped).toContain("user-a");
  });

  it("returns 404 when caller has no project membership", async () => {
    mocks.projectIds = [];
    const app = testApp();
    const res = await app.request("/api/v1/data/uploads/foo.csv", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleaned: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GC-03: DELETE /uploads fallback adds userId filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = { id: "user-a", email: "[EMAIL]", role: "user" };
    mocks.uploadedFilesRows = [];
    mocks.uploadsRows = [];
    lastDeleteWhere = null;
  });

  it("writes uploads delete with eq(uploads.userId, user.id)", async () => {
    mocks.uploadsRows = [{ filePath: "/data/uploads/foo.csv", cleanedFilePath: null }];
    const app = testApp();
    const res = await app.request("/api/v1/data/uploads/foo.csv", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(lastDeleteWhere).toBeTruthy();
    const dumped = JSON.stringify(lastDeleteWhere);
    expect(dumped).toContain("user-a");
  });

  it("returns 404 when caller cannot see the upload in uploads table", async () => {
    mocks.uploadsRows = [];
    const app = testApp();
    const res = await app.request("/api/v1/data/uploads/foo.csv", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("GC-04: /occurrences/clean/result enforces ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser = { id: "user-a", email: "[EMAIL]", role: "user" };
    mocks.uploadedFilesRows = [];
    mocks.uploadsRows = [];
  });

  it("returns 404 for fileId the caller does not own", async () => {
    mocks.uploadedFilesRows = [];
    mocks.uploadsRows = [];
    const app = testApp();
    const res = await app.request("/api/v1/data/occurrences/clean/result?file_id=other-user-file.enc");
    expect(res.status).toBe(404);
  });
});
