import { WebSocketServer, WebSocket } from "ws";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { projectMembers, projects, runs } from "../db/schema.js";

// Augment ws WebSocket to track _isAlive for heartbeat management
declare module "ws" {
  interface WebSocket {
    _isAlive?: boolean;
  }
}
import type { ServerType } from "@hono/node-server";
import { jobEventBus } from "./job-events.js";
import { getJobStatus } from "./queue.js";
import { AuthStorageUnavailable, verifyCurrentJwt } from "./auth-principal.js";

interface Client {
  ws: WebSocket;
  userId: string;
  userRole: string;
  token: string;
  subscriptions: Set<string>;
}

const clients = new Map<string, Client>();
const subscriptions = new Map<string, Set<string>>();
let _jobStatusHandler: ((event: any) => void) | null = null;
let _wss: WebSocketServer | null = null;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_INTERVAL = 30_000;
const MAX_CLIENTS = 1000;
const MAX_EVENT_AGE_MS = 3600000; // 1 hour
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _lastSentEvent = new Map<string, { state: string; progress: number; _receivedAt: number; logsKey: string }>();

function cleanupStaleEvents() {
  const now = Date.now();
  for (const [key, val] of _lastSentEvent.entries()) {
    if (now - val._receivedAt > MAX_EVENT_AGE_MS) {
      _lastSentEvent.delete(key);
    }
  }
}

function cleanupClient(clientId: string) {
  const client = clients.get(clientId);
  if (client) {
    for (const jobId of client.subscriptions) {
      subscriptions.get(jobId)?.delete(clientId);
      if (subscriptions.get(jobId)?.size === 0) {
        subscriptions.delete(jobId);
      }
    }
    clients.delete(clientId);
  }
}

function heartbeat() {
  for (const [id, client] of clients) {
    if (client.ws._isAlive === false) {
      console.warn("[ws] Terminating zombie connection:", id);
      client.ws.terminate();
      cleanupClient(id);
      continue;
    }
    client.ws._isAlive = false;
    client.ws.ping();
  }
  cleanupStaleEvents();
}

async function verifyWsToken(url: string): Promise<{ userId: string; role: string; token: string } | null> {
  try {
    const parsed = new URL(url, "http://localhost");
    const token = parsed.searchParams.get("token");
    if (!token) return null;
    const principal = await verifyCurrentJwt(token);
    return principal ? { userId: principal.id, role: principal.role, token } : null;
  } catch {
    return null;
  }
}

async function canDeliver(client: Client, jobId: string): Promise<boolean> {
  if (typeof jobId !== "string" || jobId.length === 0 || jobId.length > 255) return false;
  try {
    const principal = await verifyCurrentJwt(client.token);
    if (!principal) return false;

    // Resolve the externally supplied identifier to one durable run before
    // authorizing it. Events may carry the run UUID, Plumber job ID, or BullMQ
    // ID; treating all non-UUID values as runs.job_id both missed valid events
    // and made the resource mapping ambiguous.
    const idMatch = UUID_RE.test(jobId)
      ? or(eq(runs.id, jobId), eq(runs.jobId, jobId), eq(runs.bullmqId, jobId))
      : or(eq(runs.jobId, jobId), eq(runs.bullmqId, jobId));
    const [run] = await db
      .select({ id: runs.id, projectId: runs.projectId })
      .from(runs)
      .where(idMatch)
      .limit(1);
    if (!run) return false;

    // Admins still need a real run row, but do not need project membership.
    // For every other role query current ownership/membership directly rather
    // than using the 60-second discovery cache in access.ts. This makes a
    // committed membership removal effective for already-open streams.
    if (principal.role === "admin") return true;
    if (!run.projectId) return false;

    const [owner] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, run.projectId), eq(projects.ownerId, principal.id)))
      .limit(1);
    if (owner) return true;

    const [member] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, run.projectId), eq(projectMembers.userId, principal.id)))
      .limit(1);
    return Boolean(member);
  } catch (error) {
    if (!(error instanceof AuthStorageUnavailable)) console.warn("[ws] authorization check failed");
    return false;
  }
}

async function sendAuthorized(clientId: string, jobId: string, payload: string) {
  const client = clients.get(clientId);
  if (!client || client.ws.readyState !== WebSocket.OPEN) return;
  if (!await canDeliver(client, jobId)) {
    client.ws.close(4001, "Authorization expired");
    cleanupClient(clientId);
    return;
  }
  // Authorization is asynchronous. Re-check identity, socket state and the
  // subscription after it completes so an unsubscribe/close cannot be followed
  // by a stale replay or event write.
  const current = clients.get(clientId);
  if (current !== client || current.ws.readyState !== WebSocket.OPEN || !current.subscriptions.has(jobId)) return;
  current.ws.send(payload);
}

export function setupWebSocket(server: ServerType) {
  if (_wss) {
    cleanupWebSocket();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _wss = new WebSocketServer({ server: server as any, path: "/ws" });

  // Heartbeat: ping all clients every 30s, terminate unresponsive ones
  _heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);
  _heartbeatTimer.unref();

  _wss.on("connection", async (ws, req) => {
    if (clients.size >= MAX_CLIENTS) {
      ws.close(4003, "Too many connections");
      return;
    }

    const userInfo = await verifyWsToken(req.url || "");
    if (!userInfo) {
      ws.close(4001, "Unauthorized: invalid or missing token");
      return;
    }

    ws._isAlive = true;
    ws.on("pong", () => { ws._isAlive = true; });

    const clientId = crypto.randomUUID();
    clients.set(clientId, { ws, userId: userInfo.userId, userRole: userInfo.role, token: userInfo.token, subscriptions: new Set() });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribe") {
          const jobId = msg.jobId;
          const client = clients.get(clientId);
          if (!client) return;

          // Verify user has access to this job's run
          const hasAccess = await canDeliver(client, jobId);
          if (!hasAccess) {
            ws.send(JSON.stringify({ type: "error", message: "Access denied" }));
            return;
          }

          client.subscriptions.add(jobId);
          if (!subscriptions.has(jobId)) {
            subscriptions.set(jobId, new Set());
          }
          subscriptions.get(jobId)?.add(clientId);

          // Send current job status immediately to prevent race where
          // the job completed before the WebSocket subscribed
          getJobStatus(jobId).then(async (status) => {
            const current = clients.get(clientId);
            if (!status || current !== client || ws.readyState !== WebSocket.OPEN || !client.subscriptions.has(jobId)) return;
            if (status.state === "completed" || status.state === "failed") {
              await sendAuthorized(clientId, jobId, JSON.stringify({
                type: "status",
                jobId,
                status: status.state,
                progress: status.progress ?? 100,
                result: status.result,
                failedReason: status.failedReason,
                logs: [],
              }));
            }
          }).catch((e: unknown) => {
            console.warn("[ws] Failed to send:", e instanceof Error ? e.message : String(e));
          });
        } else if (msg.type === "unsubscribe") {
          const jobId = msg.jobId;
          clients.get(clientId)?.subscriptions.delete(jobId);
          const subscribers = subscriptions.get(jobId);
          subscribers?.delete(clientId);
          if (subscribers?.size === 0) subscriptions.delete(jobId);
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      }
    });

    ws.on("error", (err) => {
      console.error("[ws] Client error:", err.message);
      cleanupClient(clientId);
    });

    ws.on("close", () => {
      cleanupClient(clientId);
    });
  });

  _jobStatusHandler = (event) => {
    const subscribers = subscriptions.get(event.jobId);
    if (subscribers) {
      // Deduplicate: skip if the same event was already sent (compare state, progress, and logs)
      const _lastSent = _lastSentEvent.get(event.jobId);
      const logsKey = JSON.stringify(event.logs ?? []);
      if (_lastSent && _lastSent.state === event.state && _lastSent.progress === event.progress && _lastSent.logsKey === logsKey) return;
      _lastSentEvent.set(event.jobId, { state: event.state, progress: event.progress, _receivedAt: event._receivedAt, logsKey });

      // Evict from dedup map once job reaches terminal state
      if (event.state === "completed" || event.state === "failed" || event.state === "cancelled") {
        _lastSentEvent.delete(event.jobId);
      }

      const payload = JSON.stringify({
        type: "status",
        jobId: event.jobId,
        status: event.state,
        progress: event.progress,
        logs: event.logs,
        result: event.result,
        failedReason: event.failedReason,
        currentStage: event.currentStage ?? null,
        progressJson: event.progressJson ?? null,
      });
      for (const clientId of subscribers) void sendAuthorized(clientId, event.jobId, payload);
    }
  };
  jobEventBus.on("jobStatus", _jobStatusHandler);

  return {
    broadcastProgress: (jobId: string, progress: { jobId: string; progress: number; message: string; timestamp: string }) => {
      const subscribers = subscriptions.get(jobId);
      if (subscribers) {
        const data = JSON.stringify({ type: "progress", ...progress });
        for (const clientId of subscribers) void sendAuthorized(clientId, jobId, data);
      }
    },
    broadcastStatus: (jobId: string, status: string, data?: Record<string, unknown>) => {
      const subscribers = subscriptions.get(jobId);
      if (subscribers) {
        const payload = JSON.stringify({ type: "status", jobId, status, ...data });
        for (const clientId of subscribers) void sendAuthorized(clientId, jobId, payload);
      }
    },
  };
}

export function cleanupWebSocket() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  if (_jobStatusHandler) {
    jobEventBus.off("jobStatus", _jobStatusHandler);
    _jobStatusHandler = null;
  }
  if (_wss) {
    for (const [, client] of clients) {
      try { client.ws.terminate(); } catch { /* ignore */ }
    }
    _wss.close();
    _wss = null;
  }
  clients.clear();
  subscriptions.clear();
  _lastSentEvent.clear();
}
