import { EventEmitter } from "events";
import type IORedis from "ioredis";

export interface JobStatusEvent {
  jobId: string;
  state: string;
  progress: number;
  logs?: string[];
  result?: Record<string, unknown>;
  failedReason?: string;
  error_code?: string | null;
  error_hint?: string | null;
  currentStage?: string | null;
  progressJson?: any;
  _receivedAt?: number;
  // When set, the event originated from Redis pub/sub (remote replica)
  _originPid?: number;
}

// Lazy-loaded Redis pub connection — created on first use to avoid import-order issues
let _redisPub: IORedis | null = null;
let _redisPubInit: Promise<void> | null = null;
let _redisPubError: boolean = false;

async function initRedisPub(): Promise<void> {
  if (_redisPubError || _redisPub) return;
  try {
    const { getSharedRedis } = await import("./queue.js") as { getSharedRedis: () => IORedis | null };
    const conn = getSharedRedis();
    if (conn) {
      conn.on("error", () => { _redisPubError = true; });
      _redisPub = conn;
    }
  } catch {
    _redisPubError = true;
  }
}

const REDIS_CHANNEL = "sdm:job-events";

class JobEventBus extends EventEmitter {
  private static instance: JobEventBus;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): JobEventBus {
    if (!JobEventBus.instance) {
      JobEventBus.instance = new JobEventBus();
    }
    return JobEventBus.instance;
  }

  emitJobStatus(event: JobStatusEvent) {
    this.emit("jobStatus", { ...event, _receivedAt: Date.now() });

    // Fire-and-forget Redis publish for multi-replica delivery (Phase 4 hook)
    this.publishToRedis(event).catch(() => { /* non-fatal */ });
  }

  private async publishToRedis(event: JobStatusEvent): Promise<void> {
    if (_redisPubError) return;
    if (!_redisPub) {
      if (!_redisPubInit) _redisPubInit = initRedisPub();
      await _redisPubInit;
    }
    if (_redisPub) {
      await _redisPub.publish(REDIS_CHANNEL, JSON.stringify({
        ...event,
        _receivedAt: Date.now(),
        _originPid: process.pid,
      }));
    }
  }
}

export const jobEventBus = JobEventBus.getInstance();