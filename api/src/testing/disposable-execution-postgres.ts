import { execFileSync } from "node:child_process";

export const DISPOSABLE_POSTGRES_IMAGE = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
export interface InspectedContainer {
  id: string; image: string; label: string; running: boolean; restart: string;
  hostIp: string; hostPort: string; cpus: number; memory: number; pids: number;
}
export interface ContainerInspector { inspect(id: string): InspectedContainer }
export interface DisposableTarget {
  optIn?: string; databaseUrl?: string; containerId?: string; label?: string;
}
const expectedOptIn = "RUN_DISPOSABLE_LOCAL_POSTGRES_TESTS";
const fail = (): never => { throw new Error("Disposable PostgreSQL target verification failed"); };

export function createDockerInspector(): ContainerInspector {
  return {
    inspect(id) {
      let data: any;
      try {
        data = JSON.parse(execFileSync("docker", ["inspect", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0];
      } catch { return fail(); }
      const binding = data?.NetworkSettings?.Ports?.["5432/tcp"]?.[0];
      return {
        id: data?.Id,
        image: data?.Image,
        label: data?.Config?.Labels?.["sdm.execution-proof"],
        running: data?.State?.Running,
        restart: data?.HostConfig?.RestartPolicy?.Name,
        hostIp: binding?.HostIp,
        hostPort: binding?.HostPort,
        cpus: data?.HostConfig?.NanoCpus,
        memory: data?.HostConfig?.Memory,
        pids: data?.HostConfig?.PidsLimit,
      };
    },
  };
}

export function assertDisposableTarget(target: DisposableTarget, inspector: ContainerInspector): void {
  if (target.optIn !== expectedOptIn) throw new Error("Explicit disposable PostgreSQL opt-in is required");
  if (!target.databaseUrl || !target.containerId || !/^[a-f0-9]{64}$/.test(target.containerId) || !target.label) return fail();
  let url: URL;
  try { url = new URL(target.databaseUrl); } catch { return fail(); }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return fail();
  if (url.hostname !== "127.0.0.1" || url.search || url.hash || url.pathname !== "/postgres" || !url.username || !url.password) return fail();
  const actual = inspector.inspect(target.containerId);
  if (actual.id !== target.containerId || actual.image !== DISPOSABLE_POSTGRES_IMAGE || actual.label !== target.label ||
      actual.running !== true || actual.restart !== "no" || actual.hostIp !== "127.0.0.1" ||
      actual.hostPort !== url.port || !/^\d{1,5}$/.test(actual.hostPort) || Number(actual.hostPort) < 1 || Number(actual.hostPort) > 65535 ||
      actual.cpus !== 1_000_000_000 || actual.memory !== 1_073_741_824 || actual.pids !== 128) return fail();
}

export function assertEnvironmentDisposableTarget(prefix: "SDM_MIGRATION_TEST" | "SDM_EXECUTION_TEST"): void {
  assertDisposableTarget({
    optIn: process.env.SDM_EXECUTION_PG_PROOF_OPT_IN,
    databaseUrl: process.env[`${prefix}_DATABASE_URL`],
    containerId: process.env.SDM_EXECUTION_PG_CONTAINER_ID,
    label: process.env.SDM_EXECUTION_PG_LABEL,
  }, createDockerInspector());
}
