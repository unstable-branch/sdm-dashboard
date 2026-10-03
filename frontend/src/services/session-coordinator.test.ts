import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCoordinationError, withSessionMutation } from "./session-coordinator";

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
});

describe("browser session coordination", () => {
  it("fails closed when secure cross-tab locking is unavailable", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(withSessionMutation(async () => "unsafe")).rejects.toBeInstanceOf(SessionCoordinationError);
  });

  it("hydrates a persisted logout-pending notice in a fresh module context", async () => {
    localStorage.setItem("sdm-browser-session-revision", JSON.stringify({ revision: 7, kind: "logout-pending" }));
    vi.resetModules();
    const freshCoordinator = await import("./session-coordinator");
    expect(freshCoordinator.isLogoutPending()).toBe(true);
    expect(freshCoordinator.currentSessionRevision()).toBe(7);
    expect(freshCoordinator.currentSessionGeneration()).toBeGreaterThan(0);
  });

  it("fails closed on conflicting equal-revision notices in either delivery order", async () => {
    for (const order of [["changed", "logout-pending"], ["logout-pending", "changed"]] as const) {
      localStorage.clear();
      vi.resetModules();
      const coordinator = await import("./session-coordinator");
      const before = coordinator.currentSessionGeneration();
      for (const kind of order) {
        window.dispatchEvent(new StorageEvent("storage", {
          key: "sdm-browser-session-revision",
          newValue: JSON.stringify({ revision: 77, kind }),
        }));
      }
      expect(coordinator.isLogoutPending(), `order ${order.join(" then ")}`).toBe(true);
      expect(coordinator.currentSessionGeneration(), `order ${order.join(" then ")}`).toBeGreaterThan(before);
    }
  });

  it("treats exact duplicate notices as idempotent", async () => {
    localStorage.clear();
    vi.resetModules();
    const coordinator = await import("./session-coordinator");
    const event = () => window.dispatchEvent(new StorageEvent("storage", {
      key: "sdm-browser-session-revision",
      newValue: JSON.stringify({ revision: 12, kind: "changed" }),
    }));
    event();
    const generation = coordinator.currentSessionGeneration();
    event();
    expect(coordinator.currentSessionGeneration()).toBe(generation);
  });

  it.each([
    ["wrong kind", { revision: 8, kind: "unknown" }],
    ["missing revision", { kind: "logout-pending" }],
    ["string revision", { revision: "9", kind: "changed" }],
    ["unsafe revision", { revision: Number.MAX_SAFE_INTEGER + 1, kind: "changed" }],
    ["extra metadata", { revision: 9, kind: "changed", extra: true }],
  ])("fails closed on persisted malformed notice: %s", async (_name, notice) => {
    localStorage.clear();
    localStorage.setItem("sdm-browser-session-revision", JSON.stringify(notice));
    vi.resetModules();
    const coordinator = await import("./session-coordinator");
    expect(coordinator.isLogoutPending()).toBe(true);
    expect(coordinator.currentSessionGeneration()).toBeGreaterThan(0);
  });

  it("permits lock-owned logout recovery after invalid persisted metadata", async () => {
    localStorage.setItem("sdm-browser-session-revision", JSON.stringify({ revision: "bad", kind: "logout-pending" }));
    vi.resetModules();
    const coordinator = await import("./session-coordinator");
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() } });
    expect(() => coordinator.publishLogoutStarted()).toThrow(coordinator.SessionCoordinationError);
    await expect(coordinator.withSessionMutation(async () => coordinator.publishLogoutStarted())).resolves.toBe(true);
    expect(coordinator.isLogoutPending()).toBe(true);
  });

  it("serializes operations through the browser shared lock", async () => {
    let active = 0;
    let maximumActive = 0;
    const queue: Promise<unknown>[] = [];
    const lockMock = vi.fn(async (_name: string, _options: unknown, callback: (revision: number) => Promise<unknown>) => {
      const run = async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try { return await callback(0); } finally { active -= 1; }
      };
      const previous = queue.at(-1) ?? Promise.resolve();
      const current = previous.then(run);
      queue.push(current);
      return current;
    });
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: lockMock } });

    const outcomes = await Promise.all([
      withSessionMutation(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); return "one"; }),
      withSessionMutation(async () => "two"),
    ]);

    expect(outcomes).toEqual(["one", "two"]);
    expect(maximumActive).toBe(1);
    expect(lockMock).toHaveBeenCalledTimes(2);
  });
});
