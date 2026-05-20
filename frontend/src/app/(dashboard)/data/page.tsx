"use client";

import { useState } from "react";
import Link from "next/link";
import { FileUpload } from "@/components/data/file-upload";
import { GbifSearch } from "@/components/data/gbif-search";
import { PreviewTable } from "@/components/data/preview-table";
import { CleaningTable } from "@/components/data/cleaning-table";
import { OccurrenceMap } from "@/components/data/occurrence-map";
import { SourceCounts } from "@/components/data/source-counts";
import { JobProgress } from "@/components/jobs/job-progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Globe, FileArchive, Wand2, Map, Loader2, CheckCircle2 } from "lucide-react";
import { useSDMStore } from "@/stores/sdm-store";

interface OccurrencePoint {
  longitude: number;
  latitude: number;
  source?: string;
  flagged?: boolean;
  [key: string]: unknown;
}

export default function DataPage() {
  const setOccurrenceFilePath = useSDMStore((s) => s.setOccurrenceFilePath);
  const setRecordCount = useSDMStore((s) => s.setRecordCount);
  const occurrenceFilePath = useSDMStore((s) => s.occurrenceFilePath);

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);

  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<Record<string, unknown> | null>(null);
  const [cleanJobId, setCleanJobId] = useState<string | null>(null);
  const [useAsync, setUseAsync] = useState(false);

  const [gbifLoading, setGbifLoading] = useState(false);
  const [gbifError, setGbifError] = useState<string | null>(null);
  const [gbifResult, setGbifResult] = useState<Record<string, unknown> | null>(null);

  const [flaggedIndices, setFlaggedIndices] = useState<Set<number>>(new Set());

  const handleUpload = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);
    setCleanResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/data/occurrences/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const result = await res.json();
      setUploadResult(result);
      if (result.file_path) {
        setOccurrenceFilePath(result.file_path);
        setRecordCount(result.n_rows || 0);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleClean = async () => {
    if (!uploadResult?.file_id) return;

    setCleanLoading(true);
    setCleanError(null);
    setFlaggedIndices(new Set());

    try {
      const res = await fetch("/api/v1/data/occurrences/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: uploadResult.file_id,
          min_source_records: 15,
          merge_small_sources: true,
          use_cc: false,
          cc_tests: "all",
          async: useAsync,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Clean failed");
      }

      const result = await res.json();

      if (useAsync && result.jobId) {
        setCleanJobId(result.jobId);
      } else {
        setCleanResult(result);
      }
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : "Clean failed");
    } finally {
      if (!useAsync) {
        setCleanLoading(false);
      }
    }
  };

  const handleCleanComplete = (result: Record<string, unknown>) => {
    setCleanResult(result.data as Record<string, unknown> | undefined ?? result);
    setCleanJobId(null);
    setCleanLoading(false);
  };

  const handleGbifSearch = async (taxon: string, country: string, maxRecords: number) => {
    setGbifLoading(true);
    setGbifError(null);
    setGbifResult(null);

    try {
      const res = await fetch("/api/v1/data/occurrences/gbif/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxon, country, max_records: maxRecords }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "GBIF search failed");
      }

      const result = await res.json();
      setGbifResult(result);
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "GBIF search failed");
    } finally {
      setGbifLoading(false);
    }
  };

  const uploadPreview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const gbifPreview = gbifResult?.preview as Array<Record<string, unknown>> | undefined;
  const cleanPreview = cleanResult?.occurrence_preview as OccurrencePoint[] | undefined;
  const sourceCounts = cleanResult?.source_counts as Record<string, number> | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Occurrence Data</h1>
        <p className="text-sdm-muted mt-1">
          Upload occurrence records, fetch from GBIF, or parse a Darwin Core Archive.
        </p>
      </div>

      <Tabs defaultValue="upload" className="space-y-4">
        <TabsList className="grid w-full max-w-lg grid-cols-5">
          <TabsTrigger value="upload" className="flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="gbif" className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            GBIF
          </TabsTrigger>
          <TabsTrigger value="dwca" className="flex items-center gap-1.5">
            <FileArchive className="h-3.5 w-3.5" />
            DwC-A
          </TabsTrigger>
          <TabsTrigger value="clean" className="flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" />
            Clean
          </TabsTrigger>
          <TabsTrigger value="map" className="flex items-center gap-1.5">
            <Map className="h-3.5 w-3.5" />
            Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Upload occurrence file</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Upload a CSV, TSV, or ZIP file containing occurrence records.
              The file must have longitude and latitude columns (aliases like lon/lat/x/y are detected automatically).
            </p>
            <FileUpload
              onUpload={handleUpload}
              loading={uploadLoading}
              error={uploadError}
            />
          </div>

          {uploadPreview && uploadPreview.length > 0 && (
            <PreviewTable data={uploadPreview} title="Preview (first 5 records)" />
          )}

          {typeof uploadResult?.file_path === "string" && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle2 className="h-4 w-4" />
                <span>Ready for modeling — {Number(uploadResult.n_rows ?? 0).toLocaleString()} records loaded</span>
              </div>
              <Link href="/model" className="text-sm font-medium text-sdm-accent hover:underline">
                Go to Model tab →
              </Link>
            </div>
          )}
        </TabsContent>

        <TabsContent value="gbif" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Fetch from GBIF</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Search the Global Biodiversity Information Facility for occurrence records.
            </p>
            <GbifSearch
              onSearch={handleGbifSearch}
              loading={gbifLoading}
              error={gbifError}
              result={gbifResult}
            />
          </div>

          {gbifPreview && gbifPreview.length > 0 && (
            <PreviewTable data={gbifPreview} title="GBIF Preview (first 5 records)" />
          )}
        </TabsContent>

        <TabsContent value="dwca" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Parse Darwin Core Archive</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Upload a GBIF bulk download ZIP file. The archive is parsed automatically,
              extracting occurrence data and dataset DOI for provenance.
            </p>
            <FileUpload
              onUpload={handleUpload}
              loading={uploadLoading}
              error={uploadError}
            />
          </div>

          {uploadPreview && uploadPreview.length > 0 && (
            <PreviewTable data={uploadPreview} title="DwC-A Preview (first 5 records)" />
          )}
        </TabsContent>

        <TabsContent value="clean" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
            <h2 className="text-lg font-semibold text-sdm-heading mb-4">Clean occurrence data</h2>
            <p className="text-sm text-sdm-muted mb-4">
              Remove duplicates, filter invalid coordinates, and optionally run CoordinateCleaner tests.
            </p>

            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2 text-sm text-sdm-text">
                <input
                  type="checkbox"
                  checked={useAsync}
                  onChange={(e) => setUseAsync(e.target.checked)}
                  className="rounded border-sdm-border bg-sdm-surface-soft"
                />
                Run in background (for large datasets)
              </label>
            </div>

            <button
              onClick={handleClean}
              disabled={cleanLoading || !uploadResult?.file_id || !!cleanJobId}
              className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cleanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {cleanLoading ? "Cleaning..." : cleanJobId ? "Running..." : "Run cleaning"}
            </button>

            {cleanError && (
              <div className="mt-4 flex items-center gap-2 rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
                <span>{cleanError}</span>
              </div>
            )}

            {cleanJobId && (
              <div className="mt-4">
                <JobProgress jobId={cleanJobId} onComplete={handleCleanComplete} />
              </div>
            )}
          </div>

          {cleanResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Original</p>
                  <p className="mt-1 text-xl font-bold text-sdm-heading">{String(cleanResult.original_rows)}</p>
                </div>
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Valid</p>
                  <p className="mt-1 text-xl font-bold text-sdm-accent">{String(cleanResult.valid_records)}</p>
                </div>
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Bad coords</p>
                  <p className="mt-1 text-xl font-bold text-sdm-danger">{String(cleanResult.removed_bad_coordinates)}</p>
                </div>
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Duplicates</p>
                  <p className="mt-1 text-xl font-bold text-sdm-warning">{String(cleanResult.removed_duplicates)}</p>
                </div>
              </div>

              {sourceCounts && <SourceCounts counts={sourceCounts} total={Number(cleanResult.valid_records)} />}

              {cleanPreview && cleanPreview.length > 0 && (
                <CleaningTable
                  data={cleanPreview}
                  title="Cleaned records"
                  onFlagToggle={(idx, flagged) => {
                    setFlaggedIndices((prev) => {
                      const next = new Set(prev);
                      if (flagged) next.add(idx);
                      else next.delete(idx);
                      return next;
                    });
                  }}
                />
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="map" className="space-y-4">
          {cleanPreview && cleanPreview.length > 0 ? (
            <>
              <OccurrenceMap points={cleanPreview} flaggedIndices={flaggedIndices} />
              <div className="flex items-center gap-4 text-sm text-sdm-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-blue-500" />
                  Clean
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  Flagged
                </span>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
              Clean occurrence data first to see the map.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
