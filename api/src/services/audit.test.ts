import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  db: {
    insert: vi.fn(),
  },
}));

describe("Audit Service", () => {
  describe("logAction", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
    });

    it("inserts audit log entry with all fields", async () => {
      vi.mock("../db", () => ({
        db: {
          insert: vi.fn(() => ({
            values: vi.fn(() => Promise.resolve()),
          })),
        },
      }));

      const { logAction } = await import("../services/audit");
      const { db } = await import("../db");

      await logAction({
        userId: "user-1",
        action: "user_login",
        entity: "users",
        entityId: "user-1",
        ipAddress: "[IP_ADDRESS]",
        userAgent: "Chrome/120",
        details: { browser: "Chrome" },
      });

      expect(db.insert).toHaveBeenCalled();
      const insertCall = (db.insert as any).mock.calls[0][0];
      expect(insertCall).toBeDefined();
    });

    it("handles missing optional fields", async () => {
      vi.mock("../db", () => ({
        db: {
          insert: vi.fn(() => ({
            values: vi.fn(() => Promise.resolve()),
          })),
        },
      }));

      const { logAction } = await import("../services/audit");
      const { db } = await import("../db");

      await logAction({
        userId: null,
        action: "system_event",
      });

      expect(db.insert).toHaveBeenCalled();
    });

    it("does not throw on DB error", async () => {
      vi.mock("../db", () => ({
        db: {
          insert: vi.fn(() => {
            throw new Error("DB connection lost");
          }),
        },
      }));

      const { logAction } = await import("../services/audit");

      await expect(logAction({
        userId: "user-1",
        action: "test",
      })).resolves.toBeUndefined();
    });
  });

  describe("extractClientInfo", () => {
    it("extracts IP from x-forwarded-for", async () => {
      vi.mock("../db", () => ({
        db: { insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })) },
      }));

      const { extractClientInfo } = await import("../services/audit");

      const c = {
        env: {},
        req: {
          header: (name: string) => name === "x-forwarded-for"
            ? "203.0.113.1, 10.0.0.1"
            : name === "user-agent" ? "TestAgent/1.0" : undefined,
        },
      };

      const info = extractClientInfo(c as any);
      expect(info.ipAddress).toBe("203.0.113.1");
      expect(info.userAgent).toBe("TestAgent/1.0");
    });

    it("truncates user-agent to 500 chars", async () => {
      vi.mock("../db", () => ({
        db: { insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })) },
      }));

      const { extractClientInfo } = await import("../services/audit");

      const longUA = "A".repeat(600);
      const c = {
        env: {},
        req: {
          header: (name: string) => name === "user-agent" ? longUA : undefined,
        },
      };

      const info = extractClientInfo(c as any);
      expect(info.userAgent!.length).toBe(500);
    });

    it("returns null for missing headers", async () => {
      vi.mock("../db", () => ({
        db: { insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })) },
      }));

      const { extractClientInfo } = await import("../services/audit");

      const c = { env: {}, req: { header: () => undefined } };
      const info = extractClientInfo(c as any);
      expect(info.ipAddress).toBeNull();
      expect(info.userAgent).toBeNull();
    });
  });
});