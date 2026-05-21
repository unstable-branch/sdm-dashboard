"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

interface Run {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  metrics: Record<string, unknown> | null;
}

interface RunHistoryProps {
  onRunSelect?: (runId: string) => void;
}

const statusIcons: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-4 w-4 text-sdm-accent animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  queued: <Clock className="h-4 w-4 text-sdm-muted" />,
};

export function RunHistory({ onRunSelect }: RunHistoryProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/sdm/runs")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch runs");
        return res.json();
      })
      .then((data) => {
        setRuns(data.runs || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="text-sm text-sdm-muted">Loading run history...</div>;
  }

  if (error) {
    return <div className="text-sm text-sdm-danger">{error}</div>;
  }

  if (runs.length === 0) {
    return <div className="text-sm text-sdm-muted">No runs yet. Configure and run your first model above.</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-sdm-heading">Recent runs</h3>
      <div className="space-y-2">
        {runs.slice(0, 10).map((run) => (
          <button
            key={run.id}
            onClick={() => onRunSelect?.(run.id)}
            className={cn(
              "w-full rounded-lg border border-sdm-border bg-sdm-surface p-3 text-left transition-colors hover:border-sdm-accent/50",
              run.status === "running" && "border-sdm-accent/30"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {statusIcons[run.status] || <Clock className="h-4 w-4 text-sdm-muted" />}
                <span className="text-sm font-medium text-sdm-text truncate">{run.species}</span>
              </div>
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                run.status === "completed" ? "bg-green-500/10 text-green-500" :
                run.status === "failed" ? "bg-red-500/10 text-red-500" :
                run.status === "running" ? "bg-sdm-accent/10 text-sdm-accent" :
                "bg-sdm-muted/10 text-sdm-muted"
              )}>
                {run.status}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-sdm-muted">
              <span>{run.model_id}</span>
              <span>·</span>
              <span>{new Date(run.started_at).toLocaleDateString()}</span>
              {run.metrics && (
                <>
                  <span>·</span>
                  <span>AUC: {(run.metrics as any).auc_mean?.toFixed(3) ?? "—"}</span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
