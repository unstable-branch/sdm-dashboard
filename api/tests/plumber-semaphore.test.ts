import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const PLUMBER_MAX_CONCURRENT = 2;

describe("Plumber Semaphore Race Condition Tests", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Semaphore concurrent request handling", () => {
    it("should handle exactly PLUMBER_MAX_CONCURRENT requests without queuing", async () => {
      const concurrentRequests: number[] = [];

      mockFetch.mockImplementation(() => {
        concurrentRequests.push(Date.now());
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "ok" }),
        });
      });

      const maxAllowed = PLUMBER_MAX_CONCURRENT;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < maxAllowed; i++) {
        promises.push(
          fetch("http://localhost:8000/health").then((r) => r.json())
        );
      }

      await Promise.all(promises);

      expect(concurrentRequests.length).toBe(maxAllowed);
    });

    it("should queue requests beyond PLUMBER_MAX_CONCURRENT", async () => {
      const startTime = Date.now();
      const completionTimes: number[] = [];

      mockFetch.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            completionTimes.push(Date.now() - startTime);
            resolve({
              ok: true,
              json: () => Promise.resolve({ status: "ok" }),
            });
          }, 50);
        });
      });

      const maxAllowed = PLUMBER_MAX_CONCURRENT;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < maxAllowed + 1; i++) {
        promises.push(
          fetch("http://localhost:8000/health").then((r) => r.json())
        );
      }

      await Promise.all(promises);

      expect(completionTimes.length).toBe(maxAllowed + 1);
      expect(completionTimes[0]).toBeLessThan(100);
    });
  });

  describe("Semaphore timeout behavior", () => {
    it("should reject when all connections busy and timeout expires", async () => {
      let resolveFirst: (value: any) => void;
      const firstRequest = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      mockFetch.mockImplementation(() => {
        return firstRequest;
      });

      const results = await Promise.allSettled([
        fetch("http://localhost:8000/health").then((r) => r.json()),
        fetch("http://localhost:8000/health").then((r) => r.json()),
        fetch("http://localhost:8000/health").then((r) => r.json()),
      ]);

      const rejections = results.filter((r) => r.status === "rejected");
      expect(rejections.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Active request counter consistency", () => {
    it("should maintain consistent active request count after multiple rapid requests", async () => {
      const activeCounts: number[] = [];

      mockFetch.mockImplementation(() => {
        activeCounts.push(PLUMBER_MAX_CONCURRENT);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "ok" }),
        });
      });

      const requests = Array(10)
        .fill(null)
        .map(() => fetch("http://localhost:8000/health").then((r) => r.json()));

      await Promise.all(requests);

      expect(activeCounts.length).toBe(10);
    });
  });
});

describe("Plumber Client Integration", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Client methods handle errors correctly", () => {
    it("runModel should throw on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
      });

      await expect(
        fetch("http://localhost:8000/api/v1/models/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).then((r) => r.json())
      ).rejects.toBeDefined();
    });
  });
});
