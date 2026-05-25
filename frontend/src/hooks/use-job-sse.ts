import { useEffect, useRef, useState, useCallback } from "react";

const MAX_JOBS_IN_MAP = 50;
const TERMINAL_STATES: Set<JobEvent["state"]> = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_CLEANUP_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30_000;

export interface JobEvent {
  id: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "paused" | "cancelled";
  progress: number;
  type: string;
  logs: string[];
  result?: Record<string, unknown>;
  failedReason?: string;
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

  const connect = useCallback(() => {
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

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return es;
  }, [enabled]);

  useEffect(() => {
    const es = connect();
    return () => {
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
