import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { runMigrationsWithClient } from "./migrate.js";

function client() {
  return { query: vi.fn().mockResolvedValue({}) } as unknown as PoolClient;
}

describe("runMigrationsWithClient", () => {
  it("serializes migration execution with a PostgreSQL advisory lock", async () => {
    const db = client();
    const execute = vi.fn().mockResolvedValue(undefined);

    await runMigrationsWithClient(db, execute);

    expect(db.query).toHaveBeenNthCalledWith(1, "SELECT pg_advisory_lock(hashtext($1))", ["sdm-dashboard-schema-migration"]);
    expect(execute).toHaveBeenCalledWith(db);
    expect(db.query).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_unlock(hashtext($1))", ["sdm-dashboard-schema-migration"]);
  });

  it("releases the writer lock when a migration fails", async () => {
    const db = client();
    const failure = new Error("migration failed");

    await expect(runMigrationsWithClient(db, vi.fn().mockRejectedValue(failure))).rejects.toThrow(failure);
    expect(db.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock(hashtext($1))", ["sdm-dashboard-schema-migration"]);
  });

  it("preserves a migration failure if advisory unlock also fails", async () => {
    const failure = new Error("migration failed");
    const unlockFailure = new Error("unlock failed");
    const db = { query: vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(unlockFailure) } as unknown as PoolClient;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runMigrationsWithClient(db, vi.fn().mockRejectedValue(failure))).rejects.toBe(failure);
    expect(error).toHaveBeenCalledWith("[Migration] advisory unlock failed after migration failure:", unlockFailure);
    error.mockRestore();
  });

  it("does not let a concurrent runner enter before the current writer releases its lock", async () => {
    let locked = false;
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (query: string) => {
        queries.push(query);
        if (query.includes("advisory_lock")) {
          while (locked) await new Promise((resolve) => setTimeout(resolve, 1));
          locked = true;
        }
        if (query.includes("advisory_unlock")) locked = false;
        return {};
      }),
    } as unknown as PoolClient;
    const first = runMigrationsWithClient(db, async () => firstMayFinish);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondExecute = vi.fn().mockResolvedValue(undefined);
    const second = runMigrationsWithClient(db, secondExecute);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(secondExecute).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([first, second]);

    expect(secondExecute).toHaveBeenCalledOnce();
    expect(queries.filter((query) => query.includes("advisory_lock"))).toHaveLength(2);
  });

  it("permits a re-run after successful migrations", async () => {
    const db = client();
    const execute = vi.fn().mockResolvedValue(undefined);
    await runMigrationsWithClient(db, execute);
    await runMigrationsWithClient(db, execute);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
