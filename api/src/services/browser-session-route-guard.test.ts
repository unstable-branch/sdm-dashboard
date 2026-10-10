import { describe, expect, it, vi } from "vitest";
import { verifyRouteDatabaseOptIn } from "./browser-session-route-guard.js";

const containerId = "a".repeat(64);
const expectedUrl = "postgresql://sdm_lifecycle_test@127.0.0.1:54321/sdm_lifecycle_test";
const inspected: {
  Id: string;
  Name: string;
  Image: string;
  Config: { Image: string };
  State: { Status: string; Running: boolean; Health: { Status: string } };
  NetworkSettings: { Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
  Mounts: unknown[];
  HostConfig: { NanoCpus: number; Memory: number; Tmpfs: Record<string, string> };
} = {
  Id: containerId,
  Name: "/sdm-session-route-pg-20261002",
  Image: "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  Config: { Image: "postgres:17-alpine" },
  State: { Status: "running", Running: true, Health: { Status: "healthy" } },
  NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
  Mounts: [],
  HostConfig: {
    NanoCpus: 2_000_000_000,
    Memory: 536_870_912,
    Tmpfs: { "/var/lib/postgresql/data": "rw,size=480m" },
  },
};

function args(overrides: Record<string, unknown> = {}) {
  const databaseUrl = (overrides.databaseUrl as string | undefined) ?? expectedUrl;
  return {
    databaseUrl,
    containerId,
    inheritedDatabaseUrl: databaseUrl,
    inspect: () => inspected,
    ...overrides,
  };
}

describe("browser-session route database-target guard", () => {
  it("rejects a URL port not published by the inspected disposable container", () => {
    expect(() => verifyRouteDatabaseOptIn(args({
      databaseUrl: "postgresql://sdm_lifecycle_test@127.0.0.1:54322/sdm_lifecycle_test",
    }))).toThrow(/published port/);
  });

  it("accepts only the exact healthy owned container target", () => {
    const inspect = vi.fn(() => inspected);
    expect(verifyRouteDatabaseOptIn(args({ inspect }))).toBe(expectedUrl);
    expect(inspect).toHaveBeenCalledExactlyOnceWith(containerId);
  });

  it("skips only when both explicit opt-in values are absent", () => {
    const inspect = vi.fn(() => inspected);
    expect(verifyRouteDatabaseOptIn(args({ databaseUrl: undefined, containerId: undefined, inheritedDatabaseUrl: "postgresql://unrelated", inspect }))).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each([
    { databaseUrl: undefined, containerId },
    { databaseUrl: expectedUrl, containerId: undefined },
    { databaseUrl: "", containerId: undefined },
    { databaseUrl: undefined, containerId: "" },
  ])("rejects partial explicit opt-in %#", (partial) => {
    expect(() => verifyRouteDatabaseOptIn(args(partial))).toThrow(/incomplete/);
  });

  it.each([
    "postgresql://sdm_lifecycle_test@127.0.0.1/sdm_lifecycle_test",
    `${expectedUrl}?host=attacker.example`,
    `${expectedUrl}#fragment`,
    "postgresql://sdm_lifecycle_test:secret@127.0.0.1:54321/sdm_lifecycle_test",
    "postgres://sdm_lifecycle_test@127.0.0.1:54321/sdm_lifecycle_test",
    "postgresql://other@127.0.0.1:54321/sdm_lifecycle_test",
  ])("rejects unsafe or incomplete URL options: %s", (databaseUrl) => {
    expect(() => verifyRouteDatabaseOptIn(args({ databaseUrl }))).toThrow();
  });

  it.each([
    (value: typeof inspected) => { value.NetworkSettings.Ports["5432/tcp"] = null; },
    (value: typeof inspected) => { value.NetworkSettings.Ports["5432/tcp"] = []; },
    (value: typeof inspected) => { value.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "0.0.0.0", HostPort: "54321" }]; },
    (value: typeof inspected) => { value.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "54321" }, { HostIp: "127.0.0.1", HostPort: "54321" }]; },
    (value: typeof inspected) => { value.NetworkSettings.Ports["5432/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "54322" }]; },
  ])("rejects missing, malformed, non-loopback, duplicate, or mismatched bindings %#", (mutate) => {
    const altered = structuredClone(inspected);
    mutate(altered);
    expect(() => verifyRouteDatabaseOptIn(args({ inspect: () => altered }))).toThrow(/published port/);
  });

  it.each([
    (value: typeof inspected) => { value.Id = "b".repeat(64); },
    (value: typeof inspected) => { value.Name = "/sdm-ui-review-20261002-postgres-1"; },
    (value: typeof inspected) => { value.Image = "sha256:" + "b".repeat(64); },
    (value: typeof inspected) => { value.Config.Image = "postgres:latest"; },
    (value: typeof inspected) => { value.State.Status = "exited"; value.State.Running = false; },
    (value: typeof inspected) => { value.State.Health.Status = "starting"; },
  ])("rejects non-owned, stopped, or unhealthy container %#", (mutate) => {
    const altered = structuredClone(inspected);
    mutate(altered);
    expect(() => verifyRouteDatabaseOptIn(args({ inspect: () => altered }))).toThrow();
  });

  it.each([
    (value: typeof inspected) => { value.Mounts.push({ Type: "bind" }); },
    (value: typeof inspected) => { value.HostConfig.NanoCpus = 0; },
    (value: typeof inspected) => { value.HostConfig.Memory = 0; },
    (value: typeof inspected) => { delete value.HostConfig.Tmpfs["/var/lib/postgresql/data"]; },
    (value: typeof inspected) => { value.HostConfig.Tmpfs["/var/lib/postgresql/data"] = "rw"; },
    (value: typeof inspected) => { value.HostConfig.Tmpfs["/var/lib/postgresql/data"] = "rw,size=900m"; },
    (value: typeof inspected) => { value.HostConfig.Tmpfs["/other"] = "rw,size=1m"; },
  ])("rejects unsafe mounts or resource configuration %#", (mutate) => {
    const altered = structuredClone(inspected);
    mutate(altered);
    expect(() => verifyRouteDatabaseOptIn(args({ inspect: () => altered }))).toThrow(/resource/);
  });
});
