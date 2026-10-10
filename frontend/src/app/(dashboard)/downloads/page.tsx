"use client";

import { Download, Loader2, FileText, Image, Map } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCompletedRuns } from "@/hooks/use-runs";

const controlClass = "rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent";

function outputFiles(value: unknown): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
}

function fileFormat(path: string): string {
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
  if (ext === "tif") return <Map aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-400" />;
  if (ext === "png") return <Image aria-hidden="true" className="h-4 w-4 shrink-0 text-green-400" />;
  return <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-sdm-muted" />;
}

export default function DownloadsPage() {
  const { data: runs, isLoading, isFetching, error, refetch } = useCompletedRuns();
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("");
  const completedRuns = runs.map(run => ({ run, files: outputFiles(run.output_files) })).filter(({ files }) => files.length > 0);
  const totalFiles = completedRuns.reduce((total, { files }) => total + files.length, 0);
  const visibleRuns = completedRuns.map(({ run, files }) => ({
    run,
    files: files.filter(([key, path]) => {
      const text = `${run.species} ${run.model_id} ${run.id} ${key} ${path}`.toLowerCase();
      return text.includes(search.trim().toLowerCase()) && (!format || path.split(".").pop()?.toLowerCase() === format);
    }),
  })).filter(({ files }) => files.length > 0);
  const visibleFiles = visibleRuns.reduce((total, { files }) => total + files.length, 0);
  const clearFilters = () => { setSearch(""); setFormat(""); };
  const heading = (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-sdm-accent">Model output library</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-sdm-heading">Downloads</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-sdm-muted">Browse reported outputs from completed model runs. Review run evidence before using files in research or decisions.</p>
      </div>
      <Link href="/results" className={controlClass}>View run history</Link>
    </header>
  );
  const errorState = error ? (
    <div role="alert" className="rounded-lg border border-sdm-danger/30 bg-sdm-danger/5 p-4 text-sm">
      <p className="text-sdm-danger">{completedRuns.length > 0 ? "Showing cached outputs; the file list may be out of date" : "Downloadable outputs could not be loaded"}</p>
      <button type="button" onClick={() => refetch()} className={`mt-3 ${controlClass}`}>Retry output list</button>
    </div>
  ) : null;

  if (error && completedRuns.length === 0) {
    return <div className="space-y-6">{heading}{errorState}</div>;
  }
  if (isLoading) {
    return (
      <div className="space-y-6">
        {heading}
        <div role="status" className="flex items-center justify-center gap-3 h-32 text-sm text-sdm-muted">
          <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-sdm-accent" />
          Loading downloadable outputs…
        </div>
      </div>
    );
  }
  if (completedRuns.length === 0) {
    return (
      <div className="space-y-6">
        {heading}
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
          <Download aria-hidden="true" className="h-10 w-10 mx-auto mb-3 text-sdm-muted/50" />
          <h2 className="text-lg font-semibold text-sdm-heading">No outputs reported</h2>
          <p className="text-sm mt-2">{runs.length > 0 ? "The loaded completed runs did not report downloadable files. Check their run details for available evidence." : "Complete a model run to generate outputs, then review its evidence before downloading."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {heading}
      {errorState}
      <section aria-label="Find outputs" className="rounded-lg border border-sdm-border bg-sdm-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-sdm-heading">
            Search outputs
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Species, model, run ID or file" className={`mt-2 w-full ${controlClass}`} />
          </label>
          <label className="text-sm font-medium text-sdm-heading">
            Output format
            <select value={format} onChange={event => setFormat(event.target.value)} className={`mt-2 w-full sm:w-44 ${controlClass}`}>
              <option value="">All formats</option>
              <option value="tif">GeoTIFF</option>
              <option value="png">PNG image</option>
              <option value="csv">CSV data</option>
              <option value="json">JSON data</option>
              <option value="txt">Text report</option>
            </select>
          </label>
          {(search || format) && <button type="button" onClick={clearFilters} className={controlClass}>Clear filters</button>}
        </div>
        <p role="status" className="mt-4 text-sm text-sdm-muted">{isFetching && "Updating output list. "}Showing {visibleFiles} of {totalFiles} listed files from {visibleRuns.length} of {completedRuns.length} loaded output runs.</p>
      </section>
      {visibleRuns.length === 0 && <section className="rounded-lg border border-sdm-border bg-sdm-surface p-8">
        <h2 className="text-lg font-semibold text-sdm-heading">No outputs match these filters</h2>
        <p className="mt-2 text-sm text-sdm-muted">Try another species, run or output format.</p>
      </section>}
      <div className="space-y-4">
        {visibleRuns.map(({ run, files }) => {
          const runContextId = `output-run-${encodeURIComponent(run.id)}`;
          return (
            <section key={run.id} aria-labelledby={runContextId} className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
              <div className="px-4 py-4 border-b border-sdm-border flex flex-wrap items-start justify-between gap-3 sm:px-5">
                <div id={runContextId} className="min-w-0">
                  <h2 className="text-lg font-semibold text-sdm-heading">{run.species}</h2>
                  <p className="mt-1 text-sm text-sdm-muted">Model: {run.model_id} · Run: <span className="font-mono break-all">{run.id}</span></p>
                  <p className="mt-1 text-xs text-sdm-muted">Started {new Date(run.started_at).toLocaleString()} · {files.length} listed files</p>
                </div>
                <Link href={`/results/${encodeURIComponent(run.id)}`} aria-label={`Review run ${run.id}`} className={controlClass}>Review run</Link>
              </div>
              <div className="divide-y divide-sdm-border/50">
                {files.map(([key, path]) => {
                  const ext = path.split(".").pop()?.toLowerCase() || "";
                  const fileContextId = `output-file-${encodeURIComponent(run.id)}-${encodeURIComponent(key)}`;
                  return (
                    <div key={key} className="px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 hover:bg-sdm-surface-soft/50 transition-colors">
                      <div className="flex items-start gap-3 min-w-0">
                        <FileIcon ext={ext} />
                        <div className="min-w-0">
                          <p id={fileContextId} className="text-sm font-medium text-sdm-text break-all">{key}</p>
                          <p className="mt-1 text-xs text-sdm-muted break-all">{path.split("/").pop()}</p>
                          <details className="mt-2 text-xs text-sdm-muted">
                            <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent">File location</summary>
                            <p className="mt-2 break-all font-mono">{path}</p>
                          </details>
                        </div>
                      </div>
                      <a href={`/api/v1/results/file/${encodeURIComponent(path)}`} aria-describedby={`${runContextId} ${fileContextId}`} className={`flex shrink-0 items-center justify-center gap-2 ${controlClass}`}>
                        <Download aria-hidden="true" className="h-4 w-4" /> {fileFormat(path)}
                      </a>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
