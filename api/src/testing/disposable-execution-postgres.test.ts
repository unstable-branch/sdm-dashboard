import { describe, expect, it } from "vitest";
import { assertDisposableTarget, type ContainerInspector } from "./disposable-execution-postgres.js";

const id = "a".repeat(64);
const base = {
  id,
  image: "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  label: "sdm-execution-proof=nonce",
  running: true,
  restart: "no",
  hostIp: "127.0.0.1",
  hostPort: "49152",
  cpus: 1_000_000_000,
  memory: 1_073_741_824,
  pids: 128,
};
const inspector: ContainerInspector = { inspect: () => base };
const target = (overrides: Record<string, unknown> = {}) => ({
  optIn: "RUN_DISPOSABLE_LOCAL_POSTGRES_TESTS",
  databaseUrl: "postgresql://postgres:sentinel@127.0.0.1:49152/postgres",
  containerId: id,
  label: base.label,
  ...overrides,
});

describe("disposable execution PostgreSQL test boundary", () => {
  it("accepts only the exact owned loopback TCP endpoint", () => {
    expect(() => assertDisposableTarget(target(), inspector)).not.toThrow();
  });
  it("denies absent opt-in, even with an otherwise valid database URL", () => {
    expect(() => assertDisposableTarget(target({ optIn: undefined }), inspector)).toThrow(/opt-in/);
  });
  it("denies URL redirects, query parameters, and fragments before inspection", () => {
    let inspected = false;
    const spy: ContainerInspector = { inspect: () => { inspected = true; return base; } };
    expect(() => assertDisposableTarget(target({ databaseUrl: "postgresql://postgres:x@127.0.0.1:49152/postgres?host=elsewhere" }), spy)).toThrow();
    expect(inspected).toBe(false);
  });
  it("denies another host, port, container, image, or resource profile", () => {
    for (const url of ["postgresql://postgres:x@localhost:49152/postgres", "postgresql://postgres:x@127.0.0.1:5432/postgres"]) {
      expect(() => assertDisposableTarget(target({ databaseUrl: url }), inspector)).toThrow();
    }
    for (const changed of [{ containerId: "b".repeat(64) }, { label: "other" }]) {
      expect(() => assertDisposableTarget(target(changed), inspector)).toThrow();
    }
    for (const field of ["running", "restart", "hostIp", "hostPort", "cpus", "memory", "pids", "image"] as const) {
      const bad = { ...base, [field]: field === "running" ? false : field === "hostIp" ? "0.0.0.0" : field === "pids" ? 0 : "wrong" };
      expect(() => assertDisposableTarget(target(), { inspect: () => bad })).toThrow();
    }
  });
});
