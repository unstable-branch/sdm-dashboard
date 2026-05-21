"use client";

import { useState, useEffect } from "react";
import { Download, Loader2, FileText, Image, Map } from "lucide-react";

interface RunSummary {
  id: string;
  species: string;
  model_id: string;
  status: string;
  started_at: string;
  output_files: Record<string, string> | null;
}

function formatSize(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const labels: Record<string, string> = {
    tif: "GeoTIFF",
    png: "PNG image",
    txt: "Text report",
    json: "JSON data",
    csv: "CSV data",
  };
  return labels[ext || ""] || "File";
}

function FileIcon({ ext }: { ext: string }) {
  if (ext === "tif") return <Map className="h-4 w-4 text-blue-400" />;
  if (ext === "png") return <Image className="h-4 w-4 text-green-400" />;
  return <FileText className="h-4 w-4 text-sdm-muted" />;
}

export default function DownloadsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/sdm/runs")
      .then((res) => res.json())
      .then((data) => {
        const completed = Array.isArray(data) ? data.filter((r: RunSummary) => r.status === "completed" && r.output_files) : [];
        setRuns(completed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Downloads</h1>
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-sdm-heading">Downloads</h1>
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
          <Download className="h-10 w-10 mx-auto mb-3 text-sdm-muted/50" />
          <p className="text-sm font-medium text-sdm-heading">No outputs available</p>
          <p className="text-xs mt-1">Run a model first to generate downloadable outputs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Downloads</h1>
        <p className="text-sdm-muted mt-1">Browse and download outputs from completed model runs.</p>
      </div>

      <div className="space-y-4">
        {runs.map((run) => {
          const files = run.output_files ? Object.entries(run.output_files) : [];
          if (files.length === 0) return null;

          return (
            <div key={run.id} className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-sdm-border flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-sdm-heading">{run.species}</h3>
                  <p className="text-xs text-sdm-muted">{run.model_id} · {new Date(run.started_at).toLocaleString()}</p>
                </div>
                <span className="text-xs text-sdm-muted">{files.length} files</span>
              </div>
              <div className="divide-y divide-sdm-border/50">
                {files.map(([key, path]) => {
                  const ext = path.split(".").pop() || "";
                  return (
                    <div key={key} className="px-4 py-2 flex items-center justify-between hover:bg-sdm-surface-soft/50 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileIcon ext={ext} />
                        <div className="min-w-0">
                          <p className="text-sm text-sdm-text truncate">{key}</p>
                          <p className="text-xs text-sdm-muted font-mono truncate">{path}</p>
                        </div>
                      </div>
                      <a
                        href={`/api/v1/results/file/${encodeURIComponent(path)}`}
                        className="inline-flex items-center gap-1 text-xs text-sdm-accent hover:underline shrink-0 ml-4"
                      >
                        <Download className="h-3.5 w-3.5" /> {formatSize(path)}
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
