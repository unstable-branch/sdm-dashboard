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

export function useJobProgress(jobId: string | null) {
  const [job, setJob] = useState<JobProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [_error, _setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedRef = useRef(false);
  const jobIdRef = useRef(jobId);

  useEffect(() => { jobIdRef.current = jobId; }, [jobId]);

  // Fetch initial job status via REST API
  useEffect(() => {
    if (!jobId || fetchedRef.current) return;
    fetchedRef.current = true;
    _setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch(`/api/v1/jobs/${jobId}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const state = data.state as string;
        setJob({
          id: jobId,
          state: state as JobProgress["state"],
          progress: (data.progress ?? 0) as number,
          type: (data.type ?? "") as string,
          logs: [],
          result: data.result as Record<string, unknown> | undefined,
          failedReason: data.failedReason as string | undefined,
        });
      })
      .catch((err) => _setError(err instanceof Error ? err.message : "Failed to fetch job status"))
      .finally(() => clearTimeout(timeoutId));

    return () => clearTimeout(timeoutId);
  }, [jobId]);

  const connect = useCallback(() => {
    if (!jobId || typeof window === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("sdm_token") || sessionStorage.getItem("sdm_token") || "";
    const apiPort = process.env.NEXT_PUBLIC_API_PORT || "4000";
    const wsUrl = `${protocol}//${window.location.hostname}:${apiPort}/ws?token=${encodeURIComponent(token)}`;

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