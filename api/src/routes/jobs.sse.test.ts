import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const state = vi.hoisted(() => ({
  dbRows: [] as Array<unknown[]>,
  dbError: null as Error | null,
  stream: null as any,
  eventHandler: null as ((event: any) => void) | null,
  abort: null as (() => void) | null,
  getUserProjectIds: vi.fn(),
  eventOff: vi.fn(),
  verifyJwt: vi.fn(),
  verifyApiKey: vi.fn(),
  AuthStorageUnavailable: class AuthStorageUnavailable extends Error {},
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (state.dbError) throw state.dbError;
            return state.dbRows.shift() ?? [];
          }),
        })),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => {
  const field = (name: string) => ({ _name: name });
  return {
    projectMembers: { id: field("project_members.id"), projectId: field("project_members.project_id"), userId: field("project_members.user_id") },
    runs: { id: field("runs.id"), projectId: field("runs.project_id"), jobId: field("runs.job_id"), bullmqId: field("runs.bullmq_id"), status: field("runs.status") },
  };
});

vi.mock("../services/auth-principal.js", () => ({
  AuthStorageUnavailable: state.AuthStorageUnavailable,
  verifyCurrentJwt: state.verifyJwt,
  verifyCurrentApiKey: state.verifyApiKey,
}));

vi.mock("../services/queue.js", () => ({ getJobStatus: vi.fn(), getJobQueue: vi.fn() }));
vi.mock("../services/plumber.js", () => ({ plumberClient: { withUser: vi.fn(), withRole: vi.fn() } }));
vi.mock("../services/access.js", () => ({ getUserProjectIds: state.getUserProjectIds }));
vi.mock("../middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    c.set("user", { id: "user-1", email: "test@example.com", role: "viewer" });
    await next();
  }),
}));
vi.mock("../services/job-events.js", () => ({
  jobEventBus: {
    on: vi.fn((_name: string, handler: (event: any) => void) => { state.eventHandler = handler; }),
    off: vi.fn(() => state.eventOff()),
  },
}));
vi.mock("hono/streaming", () => ({
  streamSSE: vi.fn(async (_c: any, callback: (stream: any) => Promise<void>) => {
    const stream = {
      closed: false,
      onAbort: vi.fn((callback: () => void) => { state.abort = callback; }),
      writeSSE: vi.fn(async () => undefined),
      sleep: vi.fn(() => new Promise<void>(() => undefined)),
    };
    state.stream = stream;
    await callback(stream);
    return new Response(null, { status: 200 });
  }),
}));

import jobsRoutes from "./jobs.js";

function app() {
  const root = new Hono();
  root.route("/jobs", jobsRoutes);
  return root;
}

const principal = { id: "user-1", email: "current@example.com", role: "viewer", authVersion: 3, source: "jwt" as const };

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function requestStream(options: { headers?: HeadersInit; principal?: typeof principal | null; projectIds?: string[] | null; dbError?: Error } = {}) {
  state.dbRows = [];
  state.dbError = options.dbError ?? null;
  state.eventHandler = null;
  state.abort = null;
  state.stream = null;
  const selectedPrincipal = options.principal === undefined ? principal : options.principal;
  state.verifyJwt.mockResolvedValue(selectedPrincipal);
  state.verifyApiKey.mockResolvedValue(selectedPrincipal);
  state.getUserProjectIds.mockResolvedValue(options.projectIds ?? ["project-1"]);
  const response = app().request("/jobs/sse", { headers: options.headers ?? { Authorization: "Bearer presented-token" } });
  while (!state.stream) await flush();
  return response;
}

async function startStream(rows: Array<unknown[]>, options: { headers?: HeadersInit; principal?: typeof principal | null; projectIds?: string[] | null; dbError?: Error } = {}) {
  state.dbRows = rows;
  state.dbError = options.dbError ?? null;
  state.eventHandler = null;
  state.abort = null;
  state.stream = null;
  const selectedPrincipal = options.principal === undefined ? principal : options.principal;
  state.verifyJwt.mockResolvedValue(selectedPrincipal);
  state.verifyApiKey.mockResolvedValue(selectedPrincipal);
  state.getUserProjectIds.mockResolvedValue(options.projectIds ?? ["project-1"]);
  const response = app().request("/jobs/sse", { headers: options.headers ?? { Authorization: "Bearer presented-token" } });
  while (!state.eventHandler || !state.abort) await flush();
  // Do not await the request here: the stream is intentionally pending until
  // the test revokes access or invokes the abort callback.
  return { response };
}

describe("SSE current-principal authorization", () => {
  beforeEach(() => {
    state.dbRows = [];
    state.dbError = null;
    state.eventHandler = null;
    state.abort = null;
    state.stream = null;
    state.verifyJwt.mockReset();
    state.verifyApiKey.mockReset();
    state.getUserProjectIds.mockReset();
    state.eventOff.mockReset();
    state.eventOff.mockImplementation(() => undefined);
  });

  it("terminates the stream when the current JWT auth version is revoked", async () => {
    // Initial replay query, then the first event's run lookup and membership
    // lookup. The second event is denied by current JWT state.
    const { response } = await startStream([
      [],
      [{ id: "run-1", projectId: "project-1" }], [{ id: "membership-1" }],
    ]);
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 10 });
    await flush();
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);

    state.verifyJwt.mockResolvedValueOnce(null);
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 20 });
    await response;
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
  });

  it("rechecks cookie credentials and API keys without applying JWT session revocation", async () => {
    const cookie = app().request("/jobs/sse", { headers: { Cookie: "sdm_token=cookie-token" } });
    await flush();
    expect(state.verifyJwt).toHaveBeenCalledWith("cookie-token");
    state.abort?.();
    await cookie;

    const apiKey = app().request("/jobs/sse", { headers: { "X-API-Key": "automation-key" } });
    await flush();
    expect(state.verifyApiKey).toHaveBeenCalledWith("automation-key");
    state.abort?.();
    await apiKey;
  });

  it("fails closed for a deleted user before registering an event listener", async () => {
    const response = await requestStream({ principal: null });
    await response;
    expect(state.eventHandler).toBeNull();
    expect(state.stream.writeSSE).not.toHaveBeenCalled();
  });

  it("filters a foreign event without killing the stream", async () => {
    const { response } = await startStream([
      [],
      [{ id: "foreign-run", projectId: "foreign-project" }], [],
      [{ id: "run-1", projectId: "project-1" }], [{ id: "membership-1" }],
    ]);
    state.eventHandler?.({ jobId: "foreign-job", runId: "foreign-run", state: "running", progress: 10 });
    await flush();
    expect(state.stream.writeSSE).not.toHaveBeenCalled();
    expect(state.abort).toBeTypeOf("function");

    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 20 });
    await flush();
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
    state.abort?.();
    await response;
  });

  it("does not process an event queued after the client aborts", async () => {
    const { response } = await startStream([[]]);
    state.abort?.();
    await response;
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 10 });
    await flush();
    expect(state.stream.writeSSE).not.toHaveBeenCalled();
    expect(state.dbRows).toEqual([]);
  });

  it("rechecks replay access and releases the listener and client slot", async () => {
    const { response } = await startStream([
      [{ id: "run-1", status: "running" }],
      [{ id: "run-1", projectId: "project-1" }], [{ id: "membership-1" }],
    ]);
    expect(state.getUserProjectIds).toHaveBeenCalledWith(principal);
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
    state.abort?.();
    await response;
    expect(state.eventOff).toHaveBeenCalledTimes(1);
  });

  it("fails closed on current database failure during replay", async () => {
    const response = await requestStream({ dbError: new Error("database unavailable") });
    await response;
    expect(state.stream.writeSSE).not.toHaveBeenCalled();
    expect(state.eventOff).toHaveBeenCalledTimes(1);
  });

  it("stops a demoted admin stream before delivering another event", async () => {
    const admin = { ...principal, role: "admin" as const };
    const { response } = await startStream([[], [{ id: "run-1", projectId: "project-1" }]], { principal: admin });
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 10 });
    await flush();
    // Admin needs only the run lookup. A current viewer without membership is denied.
    state.verifyJwt.mockResolvedValue({ ...principal, role: "viewer" });
    state.dbRows.push([{ id: "run-1", projectId: "project-1" }], []);
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 20 });
    await response;
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
  });

  it("terminates after the previously exposed run is deleted", async () => {
    const { response } = await startStream([
      [],
      [{ id: "run-1", projectId: "project-1" }], [{ id: "membership-1" }],
      [],
    ]);
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 10 });
    await flush();
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);

    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "completed", progress: 100 });
    await response;
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
  });

  it("terminates when authentication storage becomes unavailable", async () => {
    const { response } = await startStream([
      [],
      [{ id: "run-1", projectId: "project-1" }], [{ id: "membership-1" }],
    ]);
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 10 });
    await flush();
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);

    state.verifyJwt.mockRejectedValue(new state.AuthStorageUnavailable("database unavailable"));
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 20 });
    await response;
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
  });

  it("terminates after a member is removed instead of delivering the next event", async () => {
    const { response } = await startStream([
      [],
      [{ id: "run-1", projectId: "project-1" }], [{ id: "membership-1" }],
      [{ id: "run-1", projectId: "project-1" }], [],
    ]);
    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 10 });
    await flush();
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);

    state.eventHandler?.({ jobId: "job-1", runId: "run-1", state: "running", progress: 20 });
    await response;
    expect(state.stream.writeSSE).toHaveBeenCalledTimes(1);
  });
});
