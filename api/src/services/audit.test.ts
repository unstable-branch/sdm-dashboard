import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractClientInfo, logAction, shutdownAudit } from "../services/audit.js";

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe("Audit Service", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await shutdownAudit();
  });

  describe("logAction", () => {
    it("writes JSON to stdout immediately", async () => {
      await logAction({
        userId: "user-1",
        action: "test",
      });
      expect(consoleLogSpy).toHaveBeenCalled();
      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain("[audit]");
      expect(call).toContain("test");
    });

    it("includes request context fields when provided", async () => {
      await logAction({
        userId: null,
        action: "test2",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        method: "POST",
        path: "/api/v1/test",
        statusCode: 200,
      });
      const call = consoleLogSpy.mock.calls[0][0] as string;
      expect(call).toContain("550e8400-e29b-41d4-a716-446655440000");
      expect(call).toContain("POST");
      expect(call).toContain("/api/v1/test");
      expect(call).toContain("200");
    });

    it("buffers entries for batch DB insert", async () => {
      await logAction({
        userId: null,
        action: "buffered_test",
      });
      await shutdownAudit();
    });
  });

  describe("extractClientInfo", () => {
    it("ignores x-forwarded-for when TRUSTED_PROXY_CIDRS is not configured", () => {
      delete process.env.TRUSTED_PROXY_CIDRS;
      const c = {
        env: {},
        req: {
          header: (name: string) => name === "x-forwarded-for"
            ? "203.0.113.1, 10.0.0.1"
            : name === "user-agent" ? "TestAgent/1.0" : undefined,
        },
      };

      const info = extractClientInfo(c as any);
      // GE-08: do not trust client-supplied X-Forwarded-For without proxy allow-list.
      expect(info.ipAddress).toBeNull();
      expect(info.userAgent).toBe("TestAgent/1.0");
    });

    it("honours x-forwarded-for from a configured trusted proxy", () => {
      process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
      try {
        const c = {
          env: { "x-hono-request-remote-addr": "10.0.0.5:54321" },
          req: {
            header: (name: string) => name === "x-forwarded-for"
              ? "203.0.113.1, 10.0.0.1"
              : undefined,
          },
        };

        const info = extractClientInfo(c as any);
        expect(info.ipAddress).toBe("203.0.113.1");
      } finally {
        delete process.env.TRUSTED_PROXY_CIDRS;
      }
    });

    it("truncates user-agent to 500 chars", () => {
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

    it("returns null for missing headers", () => {
      const c = { env: {}, req: { header: () => undefined } };
      const info = extractClientInfo(c as any);
      expect(info.ipAddress).toBeNull();
      expect(info.userAgent).toBeNull();
    });
  });
});
