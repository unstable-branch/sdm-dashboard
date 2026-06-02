import { useEffect, useRef, useState, useCallback } from "react";

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

export function useJobSSE(enabled = true) {
  const jobsRef = useRef<Map<string, JobEvent>>(new Map());
  const [jobs, setJobs] = useState<Map<string, JobEvent>>(new Map());
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastCleanupRef = useRef<number>(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback((isReconnect = false) => {
    if (!enabled) return;

    const es = new EventSource("/api/v1/jobs/sse");
    eventSourceRef.current = es;

    es.addEventListener("job-update", (event) => {
      try {
        const data = JSON.parse(event.data) as JobEvent;
        const now = Date.now();
        const map = jobsRef.current;
        map.set(data.id, { ...data, _receivedAt: now });

        // Throttle cleanup to every 30s instead of every event
        if (now - lastCleanupRef.current > CLEANUP_INTERVAL_MS) {
          const cleaned = cleanupJobs(map, now);
          jobsRef.current = cleaned;
          setJobs(new Map(cleaned));
          lastCleanupRef.current = now;
        } else {
          setJobs(new Map(map));
        }
      } catch {
        // Ignore parse errors
      }
    });

    es.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      if (isReconnect) { console.log("[use-job-sse] SSE reconnected"); }
      // Fetch active runs as initial state — catches jobs that emitted events before SSE connected
      fetch("/api/v1/sdm/runs?status=running&limit=10")
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.runs) {
            const now = Date.now();
            const map = new Map(jobsRef.current);
            for (const run of data.runs) {
              if (!map.has(run.id)) {
                map.set(run.id, {
                  id: run.id,
                  state: "active",
                  progress: 0,
                  type: "sdm_model",
                  logs: ["Model run in progress..."],
                  _receivedAt: now,
                });
              }
            }
            jobsRef.current = map;
            setJobs(new Map(map));
          }
        })
        .catch(() => console.warn("[use-job-sse] Failed to process SSE data"));
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;
      // Exponential backoff reconnection: 3s, 6s, 12s, 24s, max 60s
      if (enabled) {
        const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current), 60000);
        reconnectAttemptsRef.current++;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect(true);
        }, delay);
      }
    };

    return es;
  }, [enabled]);

  useEffect(() => {
    const es = connect(false);

    const onPageHide = () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      es?.close();
      eventSourceRef.current = null;
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      es?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);

  const getJob = useCallback(
    (id: string) => jobsRef.current.get(id),
    []
  );

  const getJobsByType = useCallback(
    (type: string) =>
      Array.from(jobsRef.current.values()).filter((j) => j.type === type),
    []
  );

  return {
    jobs,
    connected,
    getJob,
    getJobsByType,
  };
}
