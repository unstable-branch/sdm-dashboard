export const ROUTE_TEST_CONTAINER_NAME = "sdm-session-route-pg-20261002";
export const ROUTE_TEST_IMAGE = "postgres:17-alpine";
export const ROUTE_TEST_IMAGE_ID = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
const TEST_DATABASE = "sdm_lifecycle_test";
const TEST_USER = "sdm_lifecycle_test";
const EXPECTED_TMPFS = "rw,size=480m";

export interface RouteTestContainerInspection {
  Id?: string;
  Name?: string;
  Image?: string;
  Config?: { Image?: string };
  State?: { Status?: string; Running?: boolean; Health?: { Status?: string } };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> };
  Mounts?: unknown[];
  HostConfig?: { NanoCpus?: number; Memory?: number; Tmpfs?: Record<string, string> };
}

export interface RouteTestGuardOptions {
  databaseUrl?: string;
  containerId?: string;
  inheritedDatabaseUrl?: string;
  inspect: (immutableContainerId: string) => RouteTestContainerInspection;
}

/** Validate an explicit disposable route-test target before any database imports. */
export function verifyRouteDatabaseOptIn(options: RouteTestGuardOptions): string | undefined {
  const { databaseUrl, containerId, inheritedDatabaseUrl, inspect } = options;
  if (databaseUrl === undefined && containerId === undefined) return undefined;
  if (!databaseUrl || !containerId) throw new Error("explicit disposable route-test opt-in is incomplete");
  if (inheritedDatabaseUrl !== databaseUrl) throw new Error("DATABASE_URL is not the explicit disposable test target");
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("route-test container ID is not a canonical immutable ID");

  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("disposable route-test URL is malformed"); }
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" ||
      parsed.username !== TEST_USER || parsed.password || parsed.pathname !== `/${TEST_DATABASE}` ||
      !parsed.port || parsed.search || parsed.hash) {
    throw new Error("route integration refused a non-explicit loopback synthetic database URL");
  }
  const portNumber = Number(parsed.port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new Error("route integration refused an invalid loopback port");
  }

  const inspected = inspect(containerId);
  if (inspected.Id !== containerId || inspected.Name !== `/${ROUTE_TEST_CONTAINER_NAME}` ||
      inspected.Config?.Image !== ROUTE_TEST_IMAGE || inspected.Image !== ROUTE_TEST_IMAGE_ID) {
    throw new Error("route integration refused unverified disposable container identity");
  }
  if (inspected.State?.Status !== "running" || inspected.State.Running !== true ||
      inspected.State.Health?.Status !== "healthy") {
    throw new Error("route integration requires the owned container to be running and healthy");
  }
  const bindings = inspected.NetworkSettings?.Ports?.["5432/tcp"];
  if (!bindings || bindings.length !== 1 || bindings[0].HostIp !== "127.0.0.1" ||
      bindings[0].HostPort !== parsed.port) {
    throw new Error("route-test URL port does not match exactly one published port on the owned container");
  }
  if ((inspected.Mounts?.length ?? -1) !== 0 || inspected.HostConfig?.NanoCpus !== 2_000_000_000 ||
      inspected.HostConfig.Memory !== 536_870_912 ||
      inspected.HostConfig.Tmpfs?.["/var/lib/postgresql/data"] !== EXPECTED_TMPFS ||
      Object.keys(inspected.HostConfig.Tmpfs ?? {}).length !== 1) {
    throw new Error("route integration refused unbounded or mounted disposable container resources");
  }
  return databaseUrl;
}
