import { useEffect, useState, useCallback } from "react";
import { fetchWithAuth } from "@/services/api";

const API_BASE = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) || "";

const MAX_JOBS_IN_MAP = 50;
const TERMINAL_STATES: Set<JobEvent["state"]> = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_CLEANUP_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30_000;

export interface ProgressStage {
  timestamp: string;
  percent: number;
  detail: string;
  stage: string;
}

export interface JobEvent {
  id: string;
  state: "waiting" | "active" | "loading" | "pending" | "completed" | "failed" | "delayed" | "paused" | "cancelled";
  progress: number;
  type: string;
  logs: string[];
  result?: Record<string, unknown>;
  failedReason?: string;
  error_code?: string | null;
  error_hint?: string | null;
  currentStage?: string | null;
  progressJson?: ProgressStage[];
  _receivedAt?: number;
}

function cleanupJobs(map: Map<string, JobEvent>, now: number): Map<string, JobEvent> {
  const next = new Map(map);

  for (const [key, job] of next.entries()) {
    if (TERMINAL_STATES.has(job.state) && job._receivedAt && (now - job._receivedAt) > TERMINAL_CLEANUP_MS) {
      next.delete(key);
    }
  }

  if (next.size > MAX_JOBS_IN_MAP) {
    const terminalEntries = Array.from(next.entries()).filter(([, j]) => TERMINAL_STATES.has(j.state));
    terminalEntries.sort((a, b) => (a[1]._receivedAt || 0) - (b[1]._receivedAt || 0));
    const toRemove = next.size - MAX_JOBS_IN_MAP;
    for (let i = 0; i < toRemove && i < terminalEntries.length; i++) {
      next.delete(terminalEntries[i][0]);
    }
    if (next.size > MAX_JOBS_IN_MAP) {
      const activeEntries = Array.from(next.entries()).filter(([, j]) => !TERMINAL_STATES.has(j.state));
      activeEntries.sort((a, b) => (a[1]._receivedAt || 0) - (b[1]._receivedAt || 0));
      const remaining = next.size - MAX_JOBS_IN_MAP;
      for (let i = 0; i < remaining && i < activeEntries.length; i++) {
        next.delete(activeEntries[i][0]);
      }
    }
  }

  return next;
}

// --- Module-level singleton ---
let sharedEventSource: EventSource | null = null;
const sharedJobs = new Map<string, JobEvent>();
let sharedConnected = false;
let sharedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sharedReconnectAttempts = 0;
let lastCleanup = 0;
let subscriberCount = 0;
let sharedHasActive = false;
let sharedVersion = 0;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) {
    fn();
  }
}

function openSharedConnection(): void {
  if (sharedEventSource) return;

  const es = new EventSource(`${API_BASE}/api/v1/jobs/sse`, { withCredentials: true });
  sharedEventSource = es;

  es.addEventListener("job-update", (event) => {
    try {
      const data = JSON.parse(event.data) as JobEvent;
      const now = Date.now();
      const existing = sharedJobs.get(data.id);
      // Guard: progress must never go backwards (handles R backend regression)
      const monotonicProgress = existing && existing.progress > (data.progress ?? 0) ? existing.progress : (data.progress ?? 0);
      // Merge incoming data with existing — preserve currentStage and progressJson if new event lacks them
      // (queue worker emits events without currentStage; plumber-sync includes it)
      const merged = {
        ...data,
        logs: data.logs?.slice(-200) ?? [],
        progress: monotonicProgress,
        currentStage: data.currentStage ?? existing?.currentStage ?? null,
        progressJson: data.progressJson ?? existing?.progressJson ?? undefined,
        _receivedAt: now,
      };
      sharedJobs.set(data.id, merged);

      if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
        const cleaned = cleanupJobs(sharedJobs, now);
        sharedJobs.clear();
        for (const [k, v] of cleaned) sharedJobs.set(k, v);
        lastCleanup = now;
      }
      sharedHasActive = Array.from(sharedJobs.values()).some(
        (j) => !TERMINAL_STATES.has(j.state)
      );
      sharedVersion++;
      notifyListeners();
    } catch {
      // Ignore parse errors
    }
  });

  es.onopen = () => {
    sharedConnected = true;
    sharedReconnectAttempts = 0;
    notifyListeners();
    fetchWithAuth(`${API_BASE}/api/v1/sdm/runs?status=running&limit=10`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.runs) {
          const now = Date.now();
          for (const run of data.runs) {
            const existing = sharedJobs.get(run.id);
            if (existing) {
              // Refresh existing entry with fresher API data — only update fields
              // that have evolved (state, progress) while keeping SSE-only fields
              if (existing.state !== "active" && existing.state !== run.status) {
                sharedJobs.set(run.id, { ...existing, state: run.status === "running" ? "active" : run.status, _receivedAt: now });
              }
            } else {
              sharedJobs.set(run.id, {
                id: run.id,
                state: "active",
                progress: 0,
                type: "sdm_model",
                logs: ["Model run in progress..."],
                _receivedAt: now,
              });
            }
          }
          notifyListeners();
        }
      })
      .catch(() => {});
  };

  es.onerror = () => {
    sharedConnected = false;
    es.close();
    sharedEventSource = null;
    notifyListeners();
    const delay = Math.min(3000 * Math.pow(2, sharedReconnectAttempts), 60000);
    sharedReconnectAttempts++;
    if (sharedReconnectTimer) clearTimeout(sharedReconnectTimer);
    sharedReconnectTimer = setTimeout(() => {
      sharedReconnectTimer = null;
      openSharedConnection();
    }, delay);
  };
}

function closeSharedConnection(): void {
  if (sharedReconnectTimer) {
    clearTimeout(sharedReconnectTimer);
    sharedReconnectTimer = null;
  }
  sharedReconnectAttempts = 0;
  if (sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }
  sharedConnected = false;
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    if (subscriberCount > 0) closeSharedConnection();
  } else {
    if (subscriberCount > 0 && !sharedEventSource) openSharedConnection();
  }
}

// --- Hook ---
export function useJobSSE(enabled = true) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    subscriberCount++;
    if (subscriberCount === 1) {
      openSharedConnection();
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      subscriberCount--;
      if (subscriberCount === 0) {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        closeSharedConnection();
        // Preserve sharedJobs across navigation — data survives page transitions so
        // components remounting (e.g., ModelPage → ResultsPage) retain progress data.
        // Cleanup of terminal jobs happens via the periodic cleanupJobs() call.
      }
    };
  }, [enabled]);

  const getJob = useCallback(
    (id: string) => sharedJobs.get(id),
    []
  );

  const getJobsByType = useCallback(
    (type: string) =>
      Array.from(sharedJobs.values()).filter((j) => j.type === type),
    []
  );

  return {
    jobs: sharedJobs,
    connected: sharedConnected,
    hasActive: sharedHasActive,
    version: sharedVersion,
    getJob,
    getJobsByType,
  };
}
