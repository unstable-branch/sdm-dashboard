"use client";

import { useState } from "react";
import { Download, FileText, Copy, Check } from "lucide-react";
import { fetchWithAuth } from "@/services/api";

interface ExportPanelProps {
  runId: string;
}

export function ExportPanel({ runId }: ExportPanelProps) {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchReport = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/ecology/${runId}/report`);
      const text = await res.text();
      setReport(text);
    } catch {
      setFetchError("Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const copyReport = () => {
    if (report) {
      try {
        navigator.clipboard.writeText(report);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-sdm-heading">Export & Reporting</h3>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-sdm-surface-soft border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-50 transition-colors"
        >
          {loading ? "Generating..." : <><FileText className="h-3.5 w-3.5" /> Generate report</>}
        </button>
      </div>

      {fetchError && (
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
          {fetchError}
        </div>
      )}

      {report && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface">
          <div className="px-4 py-2 border-b border-sdm-border flex items-center justify-between">
            <span className="text-xs font-medium text-sdm-muted">Conservation Status Report</span>
            <button
              onClick={copyReport}
              className="inline-flex items-center gap-1 text-xs text-sdm-muted hover:text-sdm-text transition-colors"
            >
              {copied ? <><Check className="h-3 w-3 text-green-500" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>
          <pre className="p-4 text-xs text-sdm-text font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
            {report}
          </pre>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide">Download outputs</h4>
        <div className="space-y-2 text-sm">
          <a href={`/api/v1/ecology/${runId}/eoo-aoo`} download className="flex items-center gap-2 text-sdm-accent hover:underline">
            <Download className="h-3.5 w-3.5" /> EOO/AOO data (JSON)
          </a>
          <a href={`/api/v1/ecology/${runId}/aoa`} download className="flex items-center gap-2 text-sdm-accent hover:underline">
            <Download className="h-3.5 w-3.5" /> AOA summary (JSON)
          </a>
        </div>
        <p className="text-xs text-sdm-muted mt-3">
          GeoTIFF files (AOA mask, climate matching, MESS) are available from the Results tab.
        </p>
      </div>
    </div>
  );
}
