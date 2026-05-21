import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/services/api";
import type { SpeciesSummary, PaginationInfo } from "@/services/types";

interface UseSpeciesOptions {
  page?: number;
  limit?: number;
  autoFetch?: boolean;
}

interface UseSpeciesResult {
  species: SpeciesSummary[];
  pagination: PaginationInfo | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSpecies({ page = 1, limit = 20, autoFetch = true }: UseSpeciesOptions = {}): UseSpeciesResult {
  const [species, setSpecies] = useState<SpeciesSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);

  const fetchSpecies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ species: SpeciesSummary[]; pagination: PaginationInfo }>(
        `/api/v1/data/species?page=${page}&limit=${limit}`
      );
      setSpecies(data.species || []);
      setPagination(data.pagination || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch species");
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    if (autoFetch) fetchSpecies();
  }, [fetchSpecies, autoFetch]);

  return { species, pagination, loading, error, refetch: fetchSpecies };
}
