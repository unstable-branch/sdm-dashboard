import { WebSocketServer, WebSocket } from "ws";
import { verify } from "hono/jwt";
import type { ServerType } from "@hono/node-server";
import { jobEventBus } from "./job-events.js";
import { canAccessRun } from "./access.js";

interface Client {
  ws: WebSocket;
  userId: string;
  userRole: string;
  subscriptions: Set<string>;
}

const clients = new Map<string, Client>();
const subscriptions = new Map<string, Set<string>>();
let _jobStatusHandler: ((event: any) => void) | null = null;
let _wss: WebSocketServer | null = null;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_INTERVAL = 30_000;
const MAX_CLIENTS = 1000;
const JWT_SECRET = process.env.JWT_SECRET || "";
const _lastSentEvent = new Map<string, { state: string; progress: number; _receivedAt: number }>();

function heartbeat() {
  for (const [id, client] of clients) {
    if ((client.ws as any)._isAlive === false) {
      console.warn("[ws] Terminating zombie connection:", id);
      client.ws.terminate();
      cleanupClient(id);
      continue;
    }
    (client.ws as any)._isAlive = false;
    client.ws.ping();
  }
}

async function verifyWsToken(url: string): Promise<{ userId: string; role: string } | null> {
  try {
    const parsed = new URL(url, "http://localhost");
    const token = parsed.searchParams.get("token");
    if (!token || !JWT_SECRET) return null;
    const payload = await verify(token, JWT_SECRET, "HS256");
    return { userId: payload.sub as string, role: payload.role as string };
  } catch {
    return null;
  }
}

export function setupWebSocket(server: ServerType) {
  if (_wss) {
    cleanupWebSocket();
  }

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

    (ws as any)._isAlive = true;
    ws.on("pong", () => { (ws as any)._isAlive = true; });

    const clientId = crypto.randomUUID();
    clients.set(clientId, { ws, userId: userInfo.userId, userRole: userInfo.role, subscriptions: new Set() });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribe") {
          const jobId = msg.jobId;
          const client = clients.get(clientId);
          if (!client) return;

          // Verify user has access to this job's run
          const hasAccess = await canAccessRun(userInfo.userId, userInfo.role, jobId);
          if (!hasAccess) {
            ws.send(JSON.stringify({ type: "error", message: "Access denied" }));
            return;
          }

          client.subscriptions.add(jobId);
          if (!subscriptions.has(jobId)) {
            subscriptions.set(jobId, new Set());
          }
          subscriptions.get(jobId)?.add(clientId);
        } else if (msg.type === "unsubscribe") {
          const jobId = msg.jobId;
          clients.get(clientId)?.subscriptions.delete(jobId);
          subscriptions.get(jobId)?.delete(clientId);
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

  _jobStatusHandler = (event) => {
    const subscribers = subscriptions.get(event.jobId);
    if (subscribers) {
      // Deduplicate: skip if the same event was already sent
      const _lastSent = _lastSentEvent.get(event.jobId);
      if (_lastSent && _lastSent.state === event.state && _lastSent.progress === event.progress && _lastSent._receivedAt === event._receivedAt) return;
      _lastSentEvent.set(event.jobId, { state: event.state, progress: event.progress, _receivedAt: event._receivedAt ?? 0 });

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
      for (const clientId of subscribers) {
        const client = clients.get(clientId);
        if (client?.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
        }
      }
    }
  };
  jobEventBus.on("jobStatus", _jobStatusHandler);

  return {
    broadcastProgress: (jobId: string, progress: { jobId: string; progress: number; message: string; timestamp: string }) => {
      const subscribers = subscriptions.get(jobId);
      if (subscribers) {
        const data = JSON.stringify({ type: "progress", ...progress });
        for (const clientId of subscribers) {
          const client = clients.get(clientId);
          if (client?.ws.readyState === WebSocket.OPEN) {
            client.ws.send(data);
          }
        }
      }
    },
    broadcastStatus: (jobId: string, status: string, data?: Record<string, unknown>) => {
      const subscribers = subscriptions.get(jobId);
      if (subscribers) {
        const payload = JSON.stringify({ type: "status", jobId, status, ...data });
        for (const clientId of subscribers) {
          const client = clients.get(clientId);
          if (client?.ws.readyState === WebSocket.OPEN) {
            client.ws.send(payload);
          }
        }
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
