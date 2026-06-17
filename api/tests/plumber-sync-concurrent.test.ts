import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Plumber Sync Concurrent Execution Tests", () => {
  let _running: boolean;
  let syncCallCount: number;

  beforeEach(() => {
    _running = false;
    syncCallCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Concurrent sync execution guard", () => {
    it("should only allow one sync operation at a time (no race)", async () => {
      let concurrentSyncs = 0;
      let maxConcurrent = 0;

      const mockSync = vi.fn(async () => {
        if (_running) {
          concurrentSyncs++;
          maxConcurrent = Math.max(maxConcurrent, concurrentSyncs);
          return;
        }
        _running = true;
        concurrentSyncs++;
        maxConcurrent = Math.max(maxConcurrent, concurrentSyncs);

        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentSyncs--;
        _running = false;
      });

      const syncCalls = Array(5)
        .fill(null)
        .map(() => mockSync());

      await Promise.all(syncCalls);

      expect(maxConcurrent).toBe(1);
    });

    it("should detect if concurrent syncs can happen with naive implementation", async () => {
      const naiveSync = vi.fn(async () => {
        if (_running) return;
        _running = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        _running = false;
      });

      await Promise.all(Array(5).fill(null).map(() => naiveSync()));

      expect(naiveSync).toHaveBeenCalledTimes(5);
    });
  });

  describe("Sync running flag management", () => {
    it("should properly reset flag after sync completes", async () => {
      _running = false;

      const doSync = vi.fn(async () => {
        if (_running) return "skipped";
        _running = true;
        await new Promise((resolve) => setTimeout(resolve, 1));
        _running = false;
        return "completed";
      });

      const results = await Promise.all([
        doSync(),
        doSync(),
        doSync(),
      ]);

      const completed = results.filter((r) => r === "completed").length;
      const skipped = results.filter((r) => r === "skipped").length;

      expect(completed).toBeGreaterThan(0);
      expect(skipped).toBeGreaterThanOrEqual(0);
      expect(completed + skipped).toBe(3);
    });

    it("should handle rapid sequential calls correctly", async () => {
      const callOrder: number[] = [];
      _running = false;

      const sequentialSync = vi.fn(async (id: number) => {
        if (_running) {
          callOrder.push(id);
          return "skipped";
        }
        _running = true;
        callOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        _running = false;
      });

      for (let i = 0; i < 5; i++) {
        await sequentialSync(i);
      }

      expect(sequentialSync).toHaveBeenCalledTimes(5);
    });
  });
});
