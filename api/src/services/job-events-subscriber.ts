/**
 * Redis eventbus subscriber for cross-replica job status events.
 *
 * Architecture:
 *  - The BullMQ worker (queue.ts) is the publisher — it calls jobEventBus.emitJobStatus()
 *    which publishes to the "sdm:job-events" Redis channel.
 *  - This subscriber subscribes to the same channel on a DUPLICATE Redis connection.
 *    A separate connection is required because ioredis v5 restricts subscriber
 *    connections to SUBSCRIBE/UNSUBSCRIBE/PING/QUIT only.
 *  - On receiving an event, the subscriber re-emits it locally on the JobEventBus
 *    singleton so all existing SSE/WebSocket handlers receive it without modification.
 *  - Self-dedup: events that originated from this process (identified by _originPid
 *    matching the current process PID) are discarded to avoid double-delivery.
 *
 * Feature flag: SDM_ENABLE_EVENTBUS_SUBSCRIBE=false by default. Set to "true" on
 * each replica when multi-replica deployment is desired.
 */

import type { JobStatusEvent } from "./job-events.js";
import { jobEventBus } from "./job-events.js";
import { getSharedRedis } from "./queue.js";

const REDIS_CHANNEL = "sdm:job-events";

let _subscriberConn: import("ioredis").default | null = null;
let _subscriberReady = false;

function isSubscriberEnabled(): boolean {
  return process.env.SDM_ENABLE_EVENTBUS_SUBSCRIBE === "true";
}

export async function startJobEventSubscriber(): Promise<void> {
  if (!isSubscriberEnabled()) {
    return;
  }

  const baseConn = getSharedRedis();
  if (!baseConn) {
    console.warn("[JobEventSubscriber] Redis not available; subscriber not started");
    return;
  }

  try {
    // duplicate() is required in ioredis v5 — a subscriber connection cannot
    // share the same connection as the main pipeline.
    _subscriberConn = baseConn.duplicate();

    _subscriberConn.on("error", (err) => {
      console.error("[JobEventSubscriber] Redis subscriber error:", err?.message ?? err);
    });

    _subscriberConn.on("message", (_ch: string, message: string) => {
      let event: JobStatusEvent;
      try {
        event = JSON.parse(message) as JobStatusEvent;
      } catch {
        console.warn("[JobEventSubscriber] Failed to parse Redis message:", message.slice(0, 100));
        return;
      }

      // Self-dedup: skip events that originated from this process.
      if (event._originPid === process.pid) {
        return;
      }

      // Re-emit on the local JobEventBus so SSE/WebSocket handlers receive it.
      jobEventBus.emit("jobStatus", { ...event, _receivedAt: Date.now() });
    });

    await _subscriberConn.subscribe(REDIS_CHANNEL);
    _subscriberReady = true;
    console.log(`[JobEventSubscriber] Subscribed to ${REDIS_CHANNEL}`);
  } catch (err) {
    console.error("[JobEventSubscriber] Failed to start subscriber:", err instanceof Error ? err.message : String(err));
    _subscriberConn = null;
  }
}

export async function stopJobEventSubscriber(): Promise<void> {
  if (!_subscriberConn) return;

  try {
    if (_subscriberReady) {
      await _subscriberConn.unsubscribe(REDIS_CHANNEL);
    }
    await _subscriberConn.quit();
    console.log("[JobEventSubscriber] Disconnected");
  } catch (err) {
    console.warn("[JobEventSubscriber] Error during shutdown:", err instanceof Error ? err.message : String(err));
  } finally {
    _subscriberConn = null;
    _subscriberReady = false;
  }
}
