import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";

vi.hoisted(() => {
  process.env.JWT_SECRET = "test-secret";
});

const wsServerStore = vi.hoisted(() => ({
  instance: null as any,
}));

const mockVerify = vi.hoisted(() => vi.fn());
const mockCanAccessRun = vi.hoisted(() => vi.fn());
const mockGetJobStatus = vi.hoisted(() => vi.fn());
const mockJobEventBus = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }));

vi.mock("ws", () => ({
  WebSocketServer: vi.fn(function () {
    const handlers = new Map<string, any>();
    const instance = {
      on: vi.fn((event: string, handler: any) => {
        handlers.set(event, handler);
      }),
      close: vi.fn(),
      _handlers: handlers,
    };
    wsServerStore.instance = instance;
    return instance;
  }),
  WebSocket: { OPEN: 1, CLOSING: 2, CLOSED: 3 },
}));

vi.mock("hono/jwt", () => ({
  verify: mockVerify,
}));

vi.mock("./job-events.js", () => ({
  jobEventBus: mockJobEventBus,
}));

vi.mock("./access.js", () => ({
  canAccessRun: mockCanAccessRun,
}));

vi.mock("./queue.js", () => ({
  getJobStatus: mockGetJobStatus,
}));

import { setupWebSocket, cleanupWebSocket } from "./websocket.js";

function makeMockWs() {
  const handlers = new Map<string, any>();
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((event: string, handler: any) => { handlers.set(event, handler); }),
    _handlers: handlers,
    _isAlive: true,
  } as any;
}

function makeMockReq(url: string) {
  return { url } as any;
}

function triggerConnection(ws: any, req: any) {
  const handler = wsServerStore.instance?._handlers?.get("connection");
  if (!handler) throw new Error("No connection handler registered");
  return handler(ws, req);
}

function triggerMessage(ws: any, data: string) {
  const handler = ws._handlers.get("message");
  if (handler) handler(data);
}

function triggerClose(ws: any) {
  const handler = ws._handlers.get("close");
  if (handler) handler();
}

function triggerError(ws: any, err: Error) {
  const handler = ws._handlers.get("error");
  if (handler) handler(err);
}

async function flush() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("WebSocket service", () => {
  const fakeServer = { address: () => ({ port: 4000 }) } as any;

  beforeEach(() => {
    mockVerify.mockReset();
    mockCanAccessRun.mockReset();
    mockGetJobStatus.mockReset();
    mockJobEventBus.on.mockReset();
    mockJobEventBus.off.mockReset();
    mockVerify.mockResolvedValue({ sub: "user-1", role: "user" });
    mockCanAccessRun.mockResolvedValue(true);
    mockGetJobStatus.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanupWebSocket();
  });

  describe("setupWebSocket", () => {
    it("creates a WebSocketServer on /ws path", () => {
      setupWebSocket(fakeServer);
      expect(WebSocketServer).toHaveBeenCalledWith(
        expect.objectContaining({ server: fakeServer, path: "/ws" })
      );
    });

    it("registers a jobStatus handler on jobEventBus", () => {
      setupWebSocket(fakeServer);
      expect(mockJobEventBus.on).toHaveBeenCalledWith("jobStatus", expect.any(Function));
    });

    it("returns broadcastProgress and broadcastStatus methods", () => {
      const result = setupWebSocket(fakeServer);
      expect(result).toHaveProperty("broadcastProgress");
      expect(result).toHaveProperty("broadcastStatus");
      expect(typeof result.broadcastProgress).toBe("function");
      expect(typeof result.broadcastStatus).toBe("function");
    });
  });

  describe("connection handling", () => {
    it("rejects connections over max limit", async () => {
      setupWebSocket(fakeServer);
      for (let i = 0; i < 1000; i++) {
        await triggerConnection(makeMockWs(), makeMockReq("/ws?token=valid"));
      }
      expect(mockVerify).toHaveBeenCalledTimes(1000);

      const lastWs = makeMockWs();
      await triggerConnection(lastWs, makeMockReq("/ws?token=valid"));
      await flush();
      expect(lastWs.close).toHaveBeenCalledWith(4003, "Too many connections");
    });

    it("accepts connections under max limit", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("sets alive flag on connection", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      expect(ws._isAlive).toBe(true);
    });
  });

  describe("token authentication", () => {
    it("accepts connection with valid token", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid-token"));
      await flush();
      expect(mockVerify).toHaveBeenCalledWith("valid-token", "test-secret", "HS256");
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("rejects connection without token", async () => {
      mockVerify.mockResolvedValue(null);
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws"));
      await flush();
      expect(ws.close).toHaveBeenCalledWith(4001, "Unauthorized: invalid or missing token");
    });

    it("rejects connection with invalid token", async () => {
      mockVerify.mockRejectedValue(new Error("jwt malformed"));
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=bad"));
      await flush();
      expect(ws.close).toHaveBeenCalledWith(4001, "Unauthorized: invalid or missing token");
    });
  });

  describe("message handling", () => {
    it("handles subscribe message and verifies access", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      expect(mockCanAccessRun).toHaveBeenCalledWith("user-1", "user", "job-1");
    });

    it("sends error on subscribe when access denied", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(false);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "error", message: "Access denied" }));
    });

    it("sends current status for completed job on subscribe", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockGetJobStatus.mockResolvedValue({
        state: "completed",
        progress: 100,
        result: { some: "data" },
      });
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"status"')
      );
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.status).toBe("completed");
      expect(sent.jobId).toBe("job-1");
    });

    it("handles unsubscribe message", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      mockGetJobStatus.mockResolvedValue(null);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      ws.send.mockClear();
      triggerMessage(ws, JSON.stringify({ type: "unsubscribe", jobId: "job-1" }));
      await flush();
      const statusHandler = mockJobEventBus.on.mock.calls.find(
        (call: any) => call[0] === "jobStatus"
      )?.[1];
      statusHandler({ jobId: "job-1", state: "completed", progress: 100 });
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("sends error for invalid message format", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      triggerMessage(ws, "not json");
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "error", message: "Invalid message" }));
    });

    it("pong handler marks connection alive", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      ws._isAlive = false;
      const pongHandler = ws._handlers.get("pong");
      expect(pongHandler).toBeDefined();
      pongHandler();
      expect(ws._isAlive).toBe(true);
    });
  });

  describe("heartbeat", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("terminates zombie connections", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      ws._isAlive = false;
      vi.advanceTimersByTime(30000);
      expect(ws.terminate).toHaveBeenCalled();
    });

    it("pings alive connections", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      vi.advanceTimersByTime(30000);
      expect(ws.ping).toHaveBeenCalled();
    });
  });

  describe("event broadcasting", () => {
    it("sends status events to subscribed clients", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();

      const statusHandler = mockJobEventBus.on.mock.calls.find(
        (call: any) => call[0] === "jobStatus"
      )?.[1];
      expect(statusHandler).toBeDefined();
      statusHandler({
        jobId: "job-1",
        state: "running",
        progress: 50,
        logs: ["step 1"],
        _receivedAt: Date.now(),
      });
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"status":"running"')
      );
    });

    it("broadcastProgress sends progress to subscribers", async () => {
      const { broadcastProgress } = setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      ws.send.mockClear();
      broadcastProgress("job-1", { jobId: "job-1", progress: 75, message: "processing", timestamp: "t1" });
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"progress":75')
      );
    });

    it("broadcastStatus sends status to subscribers", async () => {
      const { broadcastStatus } = setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      ws.send.mockClear();
      broadcastStatus("job-1", "completed", { result: "ok" });
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"status":"completed"')
      );
    });

    it("does not broadcast to unsubscribed clients", async () => {
      const { broadcastProgress } = setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      mockGetJobStatus.mockResolvedValue(null);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();
      triggerMessage(ws, JSON.stringify({ type: "unsubscribe", jobId: "job-1" }));
      await flush();
      ws.send.mockClear();
      broadcastProgress("job-1", { jobId: "job-1", progress: 100, message: "done", timestamp: "t2" });
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("does not send to clients with non-OPEN readyState", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      ws.readyState = 2;
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();

      const statusHandler = mockJobEventBus.on.mock.calls.find(
        (call: any) => call[0] === "jobStatus"
      )?.[1];
      statusHandler({ jobId: "job-1", state: "completed", progress: 100 });
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("deduplication", () => {
    it("skips duplicate events with same state, progress, and logs", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();

      const statusHandler = mockJobEventBus.on.mock.calls.find(
        (call: any) => call[0] === "jobStatus"
      )?.[1];
      const event = { jobId: "job-1", state: "running", progress: 50, logs: ["step"], _receivedAt: Date.now() };
      statusHandler(event);
      expect(ws.send).toHaveBeenCalledTimes(1);
      statusHandler(event);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it("sends events with different state despite same progress", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();

      const statusHandler = mockJobEventBus.on.mock.calls.find(
        (call: any) => call[0] === "jobStatus"
      )?.[1];
      statusHandler({ jobId: "job-1", state: "running", progress: 50, logs: [], _receivedAt: Date.now() });
      expect(ws.send).toHaveBeenCalledTimes(1);
      statusHandler({ jobId: "job-1", state: "completed", progress: 100, logs: [], _receivedAt: Date.now() });
      expect(ws.send).toHaveBeenCalledTimes(2);
    });

    it("evicts dedup entry on terminal state", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      mockCanAccessRun.mockResolvedValue(true);
      triggerMessage(ws, JSON.stringify({ type: "subscribe", jobId: "job-1" }));
      await flush();

      const statusHandler = mockJobEventBus.on.mock.calls.find(
        (call: any) => call[0] === "jobStatus"
      )?.[1];
      statusHandler({ jobId: "job-1", state: "completed", progress: 100, logs: [], _receivedAt: Date.now() });
      expect(ws.send).toHaveBeenCalledTimes(1);
      statusHandler({ jobId: "job-1", state: "completed", progress: 100, logs: [], _receivedAt: Date.now() });
      expect(ws.send).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling on connection", () => {
    it("does not throw on WebSocket error", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      expect(() => triggerError(ws, new Error("connection reset"))).not.toThrow();
    });

    it("does not throw on WebSocket close", async () => {
      setupWebSocket(fakeServer);
      const ws = makeMockWs();
      await triggerConnection(ws, makeMockReq("/ws?token=valid"));
      await flush();
      expect(() => triggerClose(ws)).not.toThrow();
    });
  });

  describe("cleanupWebSocket", () => {
    it("stops heartbeat timer", () => {
      setupWebSocket(fakeServer);
      cleanupWebSocket();
      expect(wsServerStore.instance.close).toHaveBeenCalled();
    });

    it("removes jobStatus listener from event bus", () => {
      setupWebSocket(fakeServer);
      cleanupWebSocket();
      expect(mockJobEventBus.off).toHaveBeenCalledWith("jobStatus", expect.any(Function));
    });

    it("terminates all client connections", async () => {
      setupWebSocket(fakeServer);
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      await triggerConnection(ws1, makeMockReq("/ws?token=valid"));
      await flush();
      await triggerConnection(ws2, makeMockReq("/ws?token=valid"));
      await flush();
      cleanupWebSocket();
      expect(ws1.terminate).toHaveBeenCalled();
      expect(ws2.terminate).toHaveBeenCalled();
    });

    it("closes the WebSocketServer", () => {
      setupWebSocket(fakeServer);
      cleanupWebSocket();
      expect(wsServerStore.instance.close).toHaveBeenCalled();
    });

    it("is safe to call multiple times", () => {
      setupWebSocket(fakeServer);
      cleanupWebSocket();
      expect(() => cleanupWebSocket()).not.toThrow();
    });

    it("is safe to call without setup", () => {
      expect(() => cleanupWebSocket()).not.toThrow();
    });
  });
});
