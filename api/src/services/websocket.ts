import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";

interface JobProgress {
  jobId: string;
  progress: number;
  message: string;
  timestamp: string;
}

interface Client {
  ws: WebSocket;
  subscriptions: Set<string>;
}

const clients = new Map<string, Client>();
const subscriptions = new Map<string, Set<string>>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    const clientId = crypto.randomUUID();
    clients.set(clientId, { ws, subscriptions: new Set() });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribe") {
          const jobId = msg.jobId;
          clients.get(clientId)?.subscriptions.add(jobId);

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

    ws.on("close", () => {
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
    });
  });

  return {
    broadcastProgress: (jobId: string, progress: JobProgress) => {
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
