import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/services/api";
import type { RunDetail } from "@/services/types";

export function useRunDetail(runId: string | undefined) {
  return useQuery<RunDetail>({
    queryKey: ["run-detail", runId],
    queryFn: () => apiGet<RunDetail>(`/api/v1/sdm/status/${runId}`),
    enabled: !!runId,
    staleTime: 15 * 1000,
    retry: 3,
    retryDelay: (i) => Math.min(1000 * 2 ** i, 10000),
  });
}

export function usePreviousUploads() {
  return useQuery<{ uploads: Array<Record<string, unknown>> }>({
    queryKey: ["previous-uploads"],
    queryFn: () => apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/uploads"),
    staleTime: 60 * 1000,
    retry: 2,
  });
}

export function useClimateScenarios() {
  return useQuery<{ scenarios: Array<Record<string, unknown>> }>({
    queryKey: ["climate-scenarios"],
    queryFn: () => apiGet<{ scenarios: Array<Record<string, unknown>> }>("/api/v1/climate/scenarios"),
    staleTime: 60 * 1000,
    retry: 2,
  });
}
