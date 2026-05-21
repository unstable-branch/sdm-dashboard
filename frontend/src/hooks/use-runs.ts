import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/services/api";
import type { RunSummary, RunDetail, PaginationInfo } from "@/services/types";

interface UseRunsOptions {
  page?: number;
  limit?: number;
  status?: string;
  autoFetch?: boolean;
}

interface UseRunsResult {
  runs: RunSummary[];
  pagination: PaginationInfo | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useRuns({ page = 1, limit = 50, status, autoFetch = true }: UseRunsOptions = {}): UseRunsResult {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      const data = await apiGet<{ runs: RunSummary[]; pagination: PaginationInfo }>(`/api/v1/sdm/runs?${params}`);
      setRuns(data.runs || []);
      setPagination(data.pagination || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  }, [page, limit, status]);

  useEffect(() => {
    if (autoFetch) fetchRuns();
  }, [fetchRuns, autoFetch]);

  return { runs, pagination, loading, error, refetch: fetchRuns };
}

interface UseRunDetailResult {
  run: RunDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useRunDetail(runId: string | null): UseRunDetailResult {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(!!runId);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<RunDetail>(`/api/v1/sdm/status/${runId}`);
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch run");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (runId) fetchRun();
  }, [fetchRun, runId]);

  return { run, loading, error, refetch: fetchRun };
}
