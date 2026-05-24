import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/services/api";
import type { VifData, ImportanceData, ResponseCurvesData, CbiData, MessData, DiagnosticsSummary } from "@/services/types";

interface UseDiagnosticsResult {
  vif: VifData | null;
  importance: ImportanceData | null;
  responseCurves: ResponseCurvesData | null;
  cbi: CbiData | null;
  mess: MessData | null;
  summary: DiagnosticsSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDiagnostics(runId: string | null): UseDiagnosticsResult {
  const [vif, setVif] = useState<VifData | null>(null);
  const [importance, setImportance] = useState<ImportanceData | null>(null);
  const [responseCurves, setResponseCurves] = useState<ResponseCurvesData | null>(null);
  const [cbi, setCbi] = useState<CbiData | null>(null);
  const [mess, setMess] = useState<MessData | null>(null);
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [loading, setLoading] = useState(!!runId);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostics = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);

    const endpoints = [
      { url: `/api/v1/diagnostics/vif/${runId}`, setter: setVif },
      { url: `/api/v1/diagnostics/importance/${runId}`, setter: setImportance },
      { url: `/api/v1/diagnostics/response-curves/${runId}`, setter: setResponseCurves },
      { url: `/api/v1/diagnostics/cbi/${runId}`, setter: setCbi },
      { url: `/api/v1/diagnostics/mess/${runId}`, setter: setMess },
      { url: `/api/v1/diagnostics/summary/${runId}`, setter: setSummary },
    ];

    try {
    await Promise.all(
      endpoints.map(async ({ url, setter }) => {
        try {
          const data = await apiGet(url);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (setter as (value: unknown) => void)(data);
        } catch {
          setter(null);
        }
      })
    );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch diagnostics");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (runId) fetchDiagnostics();
  }, [fetchDiagnostics, runId]);

  return { vif, importance, responseCurves, cbi, mess, summary, loading, error, refetch: fetchDiagnostics };
}
