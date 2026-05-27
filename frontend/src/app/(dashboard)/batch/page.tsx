"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BatchUpload } from "@/components/batch/batch-upload";
import { BatchProgress } from "@/components/batch/batch-progress";
import { ArrowLeft, Play, Loader2, Download, RotateCcw } from "lucide-react";
import { apiGet, apiPost } from "@/services/api";

export default function BatchPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<Array<Record<string, unknown>> | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [jobIds, setJobIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null);

  const handleConfigsParsed = (parsedConfigs: Array<Record<string, unknown>>) => {
    setConfigs(parsedConfigs);
    setJobIds(null);
    setBatchId(null);
    setError(null);
    setSummaryUrl(null);
  };

  const handleRunBatch = async () => {
    if (!configs || configs.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const data = await apiPost<any>("/api/v1/sdm/batch", {
        configs,
        name: `Batch ${new Date().toLocaleDateString()} (${configs.length} species)`,
      });
      setBatchId(data.batch_id);
      setJobIds(data.job_ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch run failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!batchId) return;
    try {
      const data = await apiPost<any>(`/api/v1/sdm/batch/${batchId}/retry`, {});
      if (data.retried > 0) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  };

  const handleCancel = async () => {
    if (!batchId) return;
    try {
      await apiPost<any>(`/api/v1/sdm/batch/${batchId}/cancel`, {});
      setJobIds(jobIds); // force re-render of BatchProgress
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-sdm-muted hover:text-sdm-text">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-sdm-heading">Batch Processing</h1>
          <p className="text-sdm-muted mt-1">
            Run SDM models for multiple species from a CSV config file.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-4 text-sm text-red-500">
          {error}
        </div>
      )}

      {!jobIds ? (
        <div className="space-y-6">
          <BatchUpload onConfigsParsed={handleConfigsParsed} />

          {configs && configs.length > 0 && (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-sdm-heading">
                  {configs.length} species ready to run
                </h3>
                <button
                  onClick={handleRunBatch}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Run Batch
                    </>
                  )}
                </button>
              </div>
              <div className="rounded bg-sdm-surface-soft p-3 font-mono text-xs text-sdm-muted max-h-48 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-sdm-border/50">
                      <th className="text-left py-1">Species</th>
                      <th className="text-left py-1">Model</th>
                      <th className="text-left py-1">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {configs.map((cfg, i) => (
                      <tr key={i} className="border-b border-sdm-border/30">
                        <td className="py-1 text-sdm-text">{cfg.species as string}</td>
                        <td className="py-1 text-sdm-muted">{cfg.model_id as string}</td>
                        <td className="py-1 text-sdm-muted truncate max-w-[200px]">
                          {cfg.occurrences_csv as string}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <BatchProgress
            jobIds={jobIds}
            batchId={batchId ?? undefined}
            onRetryFailed={handleRetryFailed}
            onCancel={handleCancel}
          />
        </div>
      )}
    </div>
  );
}
