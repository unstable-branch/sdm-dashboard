"use client";

interface OdmapViewerProps {
  odmapMd: string | null;
  odmapCsv: string | null;
  loading: boolean;
}

export function OdmapViewer({ odmapMd, odmapCsv, loading }: OdmapViewerProps) {
  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading ODMAP report...</div>;
  }

  if (!odmapMd && !odmapCsv) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        <p className="text-sm">ODMAP report not available for this run.</p>
        <p className="text-xs mt-1">Re-run the model to generate ODMAP-compliant outputs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {odmapMd && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-sdm-heading">ODMAP Report</h3>
          </div>
          <pre className="text-xs text-sdm-muted font-mono whitespace-pre-wrap max-h-[70vh] overflow-y-auto bg-sdm-surface-soft p-4 rounded-lg">
            {odmapMd}
          </pre>
        </div>
      )}

      {odmapCsv && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <h3 className="text-sm font-semibold text-sdm-heading mb-2">Data dictionary</h3>
          <p className="text-xs text-sdm-muted mb-3">
            ODMAP metadata as key-value pairs. Download the CSV for full machine-readable metadata.
          </p>
          <div className="max-h-40 overflow-y-auto bg-sdm-surface-soft rounded p-2 font-mono text-xs text-sdm-muted">
            <pre className="whitespace-pre-wrap">{odmapCsv}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
