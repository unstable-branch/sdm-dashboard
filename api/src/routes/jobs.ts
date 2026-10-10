import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJobStatus, getJobQueue } from "../services/queue.js";
import { jobEventBus } from "../services/job-events.js";
import { authMiddleware, type AppEnv } from "../middleware/auth.js";
import { getUserProjectIds } from "../services/access.js";
import { db } from "../db/index.js";
import { projectMembers, runs } from "../db/schema.js";
import { eq, and, inArray, or } from "drizzle-orm";
import { plumberClient } from "../services/plumber.js";
import { AuthStorageUnavailable, verifyCurrentApiKey, verifyCurrentJwt, type Principal } from "../services/auth-principal.js";

const app = new Hono<AppEnv>();

const MAX_SSE_CLIENTS = 500;
let activeSseClients = 0;

app.use("/sse", authMiddleware);

type PresentedCredential = { kind: "jwt" | "api-key"; value: string };
type AccessCheck = { principal: Principal | null; allowed: boolean; unavailable: boolean };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("sdm_token=") || part.startsWith("__Host-sdm_token="));
  if (!match) return null;
  const prefix = match.startsWith("__Host-sdm_token=") ? "__Host-sdm_token=" : "sdm_token=";
  try { return decodeURIComponent(match.slice(prefix.length)); } catch { return null; }
}

function getPresentedCredential(c: { req: { header(name: string): string | undefined } }): PresentedCredential | null {
  const apiKey = c.req.header("X-API-Key");
  if (apiKey) return { kind: "api-key", value: apiKey };
  const authorization = c.req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return { kind: "jwt", value: token };
  }
  const cookie = getCookieToken(c.req.header("Cookie"));
  return cookie ? { kind: "jwt", value: cookie } : null;
}

async function resolvePresentedPrincipal(credential: PresentedCredential): Promise<{ principal: Principal | null; unavailable: boolean }> {
  try {
    const principal = credential.kind === "api-key"
      ? await verifyCurrentApiKey(credential.value)
      : await verifyCurrentJwt(credential.value);
    return { principal, unavailable: false };
  } catch (error) {
    if (error instanceof AuthStorageUnavailable) return { principal: null, unavailable: true };
    return { principal: null, unavailable: false };
  }
}

async function isCurrentRunAccessible(principal: Principal, runId: string): Promise<boolean> {
  // Never compare an arbitrary queue/job identifier with the UUID column.
  // PostgreSQL rejects that cast instead of treating it as a non-match.
  const idMatch = UUID_RE.test(runId)
    ? or(eq(runs.id, runId), eq(runs.jobId, runId), eq(runs.bullmqId, runId))
    : or(eq(runs.jobId, runId), eq(runs.bullmqId, runId));
  const [run] = await db.select({ id: runs.id, projectId: runs.projectId })
    .from(runs).where(idMatch).limit(1);
  if (!run) return false;
  if (principal.role === "admin") return true;
  if (!run.projectId) return false;

  const [member] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, run.projectId), eq(projectMembers.userId, principal.id))).limit(1);
  return Boolean(member);
}

async function checkSseAccess(credential: PresentedCredential, runId: string): Promise<AccessCheck> {
  const resolved = await resolvePresentedPrincipal(credential);
  if (!resolved.principal) return { ...resolved, allowed: false };
  try {
    return { principal: resolved.principal, allowed: await isCurrentRunAccessible(resolved.principal, runId), unavailable: false };
  } catch {
    return { principal: null, allowed: false, unavailable: true };
  }
}

app.get("/sse", async (c) => {
  const credential = getPresentedCredential(c);
  if (!credential) return c.json({ error: "Unauthorized" }, 401);

  if (activeSseClients >= MAX_SSE_CLIENTS) {
    return c.json({ error: "Too many connections. Try again later." }, 503);
  }
  activeSseClients++;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeSseClients = Math.max(0, activeSseClients - 1);
  };

  try {
    return await streamSSE(c, async (stream) => {
    let aborted = false;
    let wakeLoop: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { wakeLoop = resolve; });
    const stop = () => { if (!aborted) { aborted = true; wakeLoop(); } };
    stream.onAbort(stop);

    // Authenticate the presented credential again inside the stream. The
    // middleware result is only a connection-time admission check.
    const initialResolution = await resolvePresentedPrincipal(credential);
    if (!initialResolution.principal || initialResolution.unavailable) {
      cleanup();
      return;
    }
    const initialPrincipal = initialResolution.principal;

    // Listen to real-time events from plumber-sync and queue worker
    // Use a promise chain to process events sequentially (avoids pile-up from async handlers)
    let eventQueue = Promise.resolve();
    // Keep track of resources that this stream has actually exposed. An event
    // for another user's run is simply filtered; removal of access to a run
    // already exposed to this stream terminates it fail-closed.
    const authorizedRuns = new Set<string>();
    const handler = (event: { jobId: string; runId?: string; state: string; progress: number; logs?: string[]; result?: Record<string, unknown>; failedReason?: string; error_code?: string | null; error_hint?: string | null; currentStage?: string | null; progressJson?: unknown }) => {
      eventQueue = eventQueue.then(async () => {
        try {
          if (aborted) return;
          const runId = event.runId ?? event.jobId;
          const access = await checkSseAccess(credential, runId);
          if (!access.allowed || access.unavailable || !access.principal) {
            if (access.unavailable || !access.principal || authorizedRuns.has(runId) || authorizedRuns.has(event.jobId)) stop();
            return;
          }
          authorizedRuns.add(runId);
          authorizedRuns.add(event.jobId);
          if (aborted) return;
          await stream.writeSSE({
            event: "job-update",
            data: JSON.stringify({
              id: event.runId ?? event.jobId,
              type: "sdm_model",
              state: event.state,
              progress: event.progress,
              logs: event.logs,
              result: event.result,
              failedReason: event.failedReason,
              error_code: event.error_code ?? null,
              error_hint: event.error_hint ?? null,
              currentStage: event.currentStage ?? null,
              progressJson: event.progressJson ?? null,
            }),
          });
        } catch (err) {
          console.error("[jobs] SSE write failed:", err instanceof Error ? err.message : String(err));
          stop();
        }
      });
    };
    jobEventBus.on("jobStatus", handler);

    // Send initial state: active runs from DB (catches jobs that missed early SSE events)
    try {
      // Scope the candidate query from current membership before applying the
      // limit. Filtering a global first page would starve users whose runs are
      // outside that page. Each candidate is still rechecked below.
      const projectIds = initialPrincipal.role === "admin"
        ? null
        : await getUserProjectIds(initialPrincipal);
      const activeRuns = projectIds !== null && projectIds.length === 0
        ? []
        : await db
          .select({ id: runs.id, status: runs.status })
          .from(runs)
          .where(projectIds === null
            ? inArray(runs.status, ["queued", "running"])
            : and(inArray(runs.projectId, projectIds), inArray(runs.status, ["queued", "running"])))
          .limit(20);

      for (const run of activeRuns) {
        const access = await checkSseAccess(credential, run.id);
        if (!access.allowed || access.unavailable || !access.principal) {
          if (access.unavailable || !access.principal) {
            stop();
            break;
          }
          continue;
        }
        authorizedRuns.add(run.id);
        if (aborted) break;
        await stream.writeSSE({
          event: "job-update",
          data: JSON.stringify({
            id: run.id,
            type: "sdm_model",
            state: run.status,
            progress: 0,
            logs: ["Model run in progress..."],
          }),
        });
      }
      if (aborted) {
        jobEventBus.off("jobStatus", handler);
        cleanup();
        return;
      }
    } catch (err) {
      console.warn("[jobs] Failed to fetch initial active runs:", err instanceof Error ? err.message : String(err));
      stop();
      jobEventBus.off("jobStatus", handler);
      cleanup();
      return;
    }

    try {
      let lastPingAt = Date.now();
      // Keep connection open — jobEventBus handles all updates
      // Send SSE comment ping every 25s to prevent nginx/AWS ALB idle timeout (default 60s)
      while (!aborted && !stream.closed) {
        await Promise.race([stream.sleep(5000), stopped]);
        if (Date.now() - lastPingAt >= 25_000) {
          try {
            await stream.writeSSE({ event: "ping", data: "" });
            lastPingAt = Date.now();
          } catch { /* stream closed, loop will exit next iteration */ }
        }
      }
    } finally {
      jobEventBus.off("jobStatus", handler);
      cleanup();
    }
    });
  } catch (error) {
    cleanup();
    throw error;
  }
});

app.use("/:jobId", authMiddleware);

app.get("/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const user = c.get("user");
  let myProjectIds: string[] | null;
  try {
    myProjectIds = await getUserProjectIds(user);
  } catch (err) {
    console.warn("[jobs] Failed to resolve job access:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "Job status temporarily unavailable" }, 503);
  }
  const isAsyncDataJob = jobId.startsWith("climate_") || jobId.startsWith("data-");

  let persistedRun: {
    id: string;
    jobId: string | null;
    status: string;
    error: string | null;
    errorCode: string | null;
    errorHint: string | null;
    progressLog: unknown;
  } | undefined;

  if (!isAsyncDataJob) {
    try {
      const ownership = myProjectIds === null
        ? eq(runs.id, jobId)
        : and(eq(runs.id, jobId), inArray(runs.projectId, myProjectIds));
      [persistedRun] = await db
        .select({
          id: runs.id,
          jobId: runs.jobId,
          status: runs.status,
          error: runs.error,
          errorCode: runs.errorCode,
          errorHint: runs.errorHint,
          progressLog: runs.progressLog,
        })
        .from(runs)
        .where(ownership)
        .limit(1);
      if (!persistedRun) return c.json({ error: "Job not found" }, 404);
    } catch (err) {
      console.warn("[jobs] Failed to read persisted job status:", err instanceof Error ? err.message : String(err));
      return c.json({ error: "Job status temporarily unavailable" }, 503);
    }
  } else {
    if (myProjectIds !== null && myProjectIds.length === 0) {
      return c.json({ error: "Job not found" }, 404);
    }
    if (user.role !== "admin") {
      const ownedProjectIds = myProjectIds ?? [];
      const [projectRun] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(and(
          eq(runs.jobId, jobId),
          inArray(runs.projectId, ownedProjectIds)
        ))
        .limit(1);
      if (!projectRun) return c.json({ error: "Job not found" }, 404);
    }
  }

  // BullMQ has the most detailed live state while its retention window is active.
  const status = await getJobStatus(jobId).catch(() => null);
  if (status) return c.json(status);

  // Plumber uses its own job ID, which differs from the persisted run UUID.
  const plumberJobId = persistedRun?.jobId || jobId;
  const client = plumberClient.withUser(user.id).withRole(user.role);
  try {
    const plumberStatusPath = persistedRun
      ? "models/status"
      : jobId.startsWith("climate_") ? "climate/status" : "jobs/status";
    const plumberStatus = await client.get(`/api/v1/${plumberStatusPath}/${plumberJobId}`);
    return c.json({
        id: jobId,
        state: plumberStatus.status || "unknown",
        progress: plumberStatus.progress ?? 0,
        type: plumberStatus.type || "data_job",
        logs: plumberStatus.progress_log || [],
        result: plumberStatus.result || null,
        failedReason: plumberStatus.error || null,
        error_code: plumberStatus.error_code || null,
        error_hint: plumberStatus.error_hint || null,
    });
  } catch {
    // Fall through to the durable DB status for model runs.
  }

  if (persistedRun) {
    return c.json({
      id: persistedRun.id,
      state: persistedRun.status,
      progress: persistedRun.status === "completed" ? 100 : 0,
      type: "sdm_model",
      logs: Array.isArray(persistedRun.progressLog) ? persistedRun.progressLog : [],
      result: null,
      failedReason: persistedRun.error,
      error_code: persistedRun.errorCode,
      error_hint: persistedRun.errorHint,
    });
  }

  return c.json({ error: "Job not found" }, 404);
});

export default app;
