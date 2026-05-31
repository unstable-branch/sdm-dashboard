import { describe, it, expect } from "vitest";
import { extractClientInfo, logAction } from "../services/audit.js";

describe("Audit Service", () => {
  describe("logAction", () => {
    it("is a no-op after audit_logs table removal", async () => {
      await expect(logAction({
        userId: "user-1",
        action: "test",
      })).resolves.toBeUndefined();
    });
  });

  describe("extractClientInfo", () => {
    it("extracts IP from x-forwarded-for", () => {
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
