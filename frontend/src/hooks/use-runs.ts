import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/services/api";
import type { RunSummary } from "@/services/types";

interface RunsResponse {
  runs: RunSummary[];
}

export function useRuns() {
  return useQuery<RunsResponse>({
    queryKey: ["sdm-runs"],
    queryFn: () => apiGet<RunsResponse>("/api/v1/sdm/runs"),
    staleTime: 30 * 1000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    refetchOnWindowFocus: true,
  });
}

export function useCompletedRuns() {
  const { data, ...rest } = useQuery<RunsResponse>({
    queryKey: ["sdm-runs", "summary"],
    queryFn: () => apiGet<RunsResponse>("/api/v1/sdm/runs?fields=summary"),
    staleTime: 30 * 1000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    refetchOnWindowFocus: false,
  });
  const completed = (data?.runs || []).filter((r) => r.status === "completed");
  return { data: completed, ...rest };
}
