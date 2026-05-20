interface RunStatus {
  id: string;
  status: string;
  species: string;
  model_id: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  metrics: Record<string, unknown> | null;
  output_files: Record<string, string> | null;
  progress_log: string[];
}

interface DiagnosticsPanelProps {
  run: RunStatus;
}

export function DiagnosticsPanel({ run }: DiagnosticsPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h3 className="text-sm font-semibold text-sdm-heading mb-3">Run configuration</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-sdm-muted">Model</div>
          <div className="text-sdm-text font-medium">{run.model_id}</div>
          <div className="text-sdm-muted">Species</div>
          <div className="text-sdm-text font-medium">{run.species}</div>
          <div className="text-sdm-muted">Started</div>
          <div className="text-sdm-text font-medium">{new Date(run.started_at).toLocaleString()}</div>
          {run.completed_at && (
            <>
              <div className="text-sdm-muted">Completed</div>
              <div className="text-sdm-text font-medium">{new Date(run.completed_at).toLocaleString()}</div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h3 className="text-sm font-semibold text-sdm-heading mb-3">Performance log</h3>
        <div className="rounded bg-sdm-surface-soft p-3 font-mono text-xs text-sdm-muted max-h-64 overflow-y-auto">
          {run.progress_log.length > 0 ? (
            run.progress_log.map((line, i) => <div key={i} className="truncate">{line}</div>)
          ) : (
            <span className="italic">No log entries</span>
          )}
        </div>
      </div>
    </div>
  );
}
