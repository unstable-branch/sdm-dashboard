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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!jobId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

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
            logs: msg.logs ?? prev?.logs ?? [],
            result: msg.result,
            failedReason: msg.failedReason,
          }));
        } else if (msg.type === "progress" && msg.jobId === jobId) {
          setJob((prev) => prev ? { ...prev, progress: msg.progress, logs: [...prev.logs, msg.message].slice(-20) } : null);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (jobId) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
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
        wsRef.current.send(JSON.stringify({ type: "unsubscribe", jobId }));
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