import { useEffect, useRef, useState, useCallback } from "react";

export interface JobEvent {
  id: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";
  progress: number;
  type: string;
  logs: string[];
  result?: Record<string, unknown>;
  failedReason?: string;
}

export function useJobSSE(enabled = true) {
  const [jobs, setJobs] = useState<Map<string, JobEvent>>(new Map());
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    const es = new EventSource("/api/v1/sse");
    eventSourceRef.current = es;

    es.addEventListener("job-update", (event) => {
      try {
        const data = JSON.parse(event.data) as JobEvent;
        setJobs((prev) => {
          const next = new Map(prev);
          next.set(data.id, data);
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
