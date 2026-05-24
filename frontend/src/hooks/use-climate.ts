import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost } from "@/services/api";
import type { ClimateScenario } from "@/services/types";

interface UseClimateResult {
  scenarios: ClimateScenario[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  downloadClimate: (params: Record<string, unknown>) => Promise<{ jobId: string }>;
  deleteScenario: (id: string) => Promise<void>;
}

export function useClimate(): UseClimateResult {
  const [scenarios, setScenarios] = useState<ClimateScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ scenarios: ClimateScenario[] }>("/api/v1/climate/scenarios");
      setScenarios(data.scenarios || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch scenarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  const downloadClimate = useCallback(async (params: Record<string, unknown>) => {
    const data = await apiPost<{ jobId: string }>("/api/v1/climate/download", params);
    return data;
  }, []);

  const deleteScenario = useCallback(async (id: string) => {
    await apiPost(`/api/v1/climate/delete/${id}`);
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { scenarios, loading, error, refetch: fetchScenarios, downloadClimate, deleteScenario };
}
