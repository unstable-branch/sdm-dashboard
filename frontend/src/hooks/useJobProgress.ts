import { useEffect, useRef, useState, useCallback } from "react";

export interface JobProgress {
  id: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";
  progress: number;
  type: string;
  logs: string[];
  result?: Record<string, unknown>;
  failedReason?: string;
}

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL = 5000;

function mapJobData(jobId: string, data: any): JobProgress {
  return {
    id: jobId,
    state: (data.state ?? "active") as JobProgress["state"],
    progress: (data.progress ?? 0) as number,
    type: (data.type ?? "") as string,
    logs: Array.isArray(data.logs) ? data.logs : [],
    result: data.result as Record<string, unknown> | undefined,
    failedReason: data.failedReason as string | undefined,
  };
}

export function useJobProgress(jobId: string | null) {
  const [job, setJob] = useState<JobProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [_error, _setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef(jobId);

  useEffect(() => { jobIdRef.current = jobId; }, [jobId]);

  // Fetch job status via REST API — called once on mount and as polling fallback
  const fetchStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/jobs/${id}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data) return null;
      return data;
    } catch {
      return null;
    }
  }, []);

  // Initial fetch + polling fallback for missed terminal events
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const poll = async () => {
      const data = await fetchStatus(jobId);
      if (cancelled || !data) return;
      const state = data.state as string;
      setJob(mapJobData(jobId, data));
      // Stop polling once job reaches terminal state
      if (TERMINAL_STATES.has(state)) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, fetchStatus]);

  const connect = useCallback(() => {
    if (!jobId || typeof window === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const wsHost = apiUrl ? apiUrl.replace(/^http/, "ws") : `${protocol}//${window.location.host}`;
    const token = typeof window !== "undefined" ? (localStorage.getItem("sdm_token") || sessionStorage.getItem("sdm_token")) : null;
    const wsUrl = `${wsHost}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe", jobId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "status" && msg.jobId === jobId) {
          setJob((prev) => ({
            ...prev!,
            id: msg.jobId,
            state: msg.status,
            progress: msg.progress ?? prev?.progress ?? 0,
            logs: Array.isArray(msg.logs) ? msg.logs : (prev?.logs ?? []),
            result: msg.result,
            failedReason: msg.failedReason,
          }));
        } else if (msg.type === "progress" && msg.jobId === jobId) {
          setJob((prev) => prev ? { ...prev, progress: msg.progress, logs: [...(Array.isArray(prev.logs) ? prev.logs : []), msg.message].slice(-20) } : null);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (jobId) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (jobIdRef.current === jobId) connect();
        }, 5000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    connect();

    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ type: "unsubscribe", jobId }));
        } catch { /* ignore */ }
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [jobId, connect]);

  return { job, connected };
}
