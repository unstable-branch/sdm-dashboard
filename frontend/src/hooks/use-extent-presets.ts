import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/services/api";

export interface ExtentPresetInfo {
  id: string;
  label: string;
  bbox?: [number, number, number, number];
  polygon?: string;
  has_polygon?: boolean;
}

interface ExtentsPresetsResponse {
  presets: Record<string, ExtentPresetInfo>;
}

export function useExtentPresets() {
  return useQuery<ExtentsPresetsResponse, Error>({
    queryKey: ["extent-presets"],
    queryFn: () => apiGet<ExtentsPresetsResponse>("/api/v1/extent/presets"),
    staleTime: 60 * 60 * 1000,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    initialData: () => ({ presets: {} }),
  });
}
