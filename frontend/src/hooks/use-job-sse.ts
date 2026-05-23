import { useEffect, useRef, useState, useCallback } from "react";

const MAX_JOBS_IN_MAP = 50;
const TERMINAL_STATES: Set<JobEvent["state"]> = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_CLEANUP_MS = 5 * 60 * 1000; // 5 minutes

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

export function useJobSSE(enabled = true) {
  const [jobs, setJobs] = useState<Map<string, JobEvent>>(new Map());
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    const es = new EventSource("/api/v1/jobs/sse");
    eventSourceRef.current = es;

    es.addEventListener("job-update", (event) => {
      try {
        const data = JSON.parse(event.data) as JobEvent;
        const now = Date.now();
        setJobs((prev) => {
          const next = new Map(prev);
          next.set(data.id, { ...data, _receivedAt: now });

          // Remove terminal-state jobs older than 5 minutes
          for (const [key, job] of next.entries()) {
            if (TERMINAL_STATES.has(job.state) && job._receivedAt && (now - job._receivedAt) > TERMINAL_CLEANUP_MS) {
              next.delete(key);
            }
          }

          // Cap map size — remove oldest terminal jobs first
          if (next.size > MAX_JOBS_IN_MAP) {
            const terminalEntries = Array.from(next.entries()).filter(([, j]) => TERMINAL_STATES.has(j.state));
            terminalEntries.sort((a, b) => (a[1]._receivedAt || 0) - (b[1]._receivedAt || 0));
            const toRemove = next.size - MAX_JOBS_IN_MAP;
            for (let i = 0; i < toRemove && i < terminalEntries.length; i++) {
              next.delete(terminalEntries[i][0]);
            }
            // If still over cap, remove oldest active jobs
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
        });
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
    (id: string) => jobs.get(id),
    [jobs]
  );

  const getJobsByType = useCallback(
    (type: string) =>
      Array.from(jobs.values()).filter((j) => j.type === type),
    [jobs]
  );

  return {
    jobs,
    connected,
    getJob,
    getJobsByType,
  };
}
