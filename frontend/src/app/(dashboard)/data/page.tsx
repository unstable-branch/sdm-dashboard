"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { FileUpload } from "@/components/data/file-upload";
import { GbifSearch } from "@/components/data/gbif-search";
import { PreviewTable } from "@/components/data/preview-table";
import { CleaningTable } from "@/components/data/cleaning-table";
import { SourceCounts } from "@/components/data/source-counts";
import { JobProgress } from "@/components/jobs/job-progress";
import { DownloadProgress } from "@/components/climate/download-progress";
import { ScenarioList } from "@/components/climate/scenario-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Globe, FileArchive, Wand2, Map, Cloud, Loader2, CheckCircle2, Download } from "lucide-react";
import { useSDMStore } from "@/stores/sdm-store";
import { apiUpload, apiPost, apiGet } from "@/services/api";
import { BIOVAR_CHOICES, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";

const OccurrenceMap = dynamic(() => import("@/components/data/occurrence-map").then(m => m.OccurrenceMap), {
  ssr: false,
  loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div>,
});

interface OccurrencePoint {
  longitude: number;
  latitude: number;
  source?: string;
  flagged?: boolean;
  [key: string]: unknown;
}

export default function DataPage() {
  return (
    <Suspense fallback={null}>
      <DataPageContent />
    </Suspense>
  );
}

function DataPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "upload";

  const setOccurrenceFilePath = useSDMStore((s) => s.setOccurrenceFilePath);
  const setRecordCount = useSDMStore((s) => s.setRecordCount);
  const uploadResult = useSDMStore((s) => s.uploadResult);
  const setUploadResult = useSDMStore((s) => s.setUploadResult);
  const cleanResult = useSDMStore((s) => s.cleanResult);
  const setCleanResult = useSDMStore((s) => s.setCleanResult);
  const flaggedIndicesArray = useSDMStore((s) => s.flaggedIndices);
  const setFlaggedIndicesArray = useSDMStore((s) => s.setFlaggedIndices);
  const flaggedIndices = useMemo(() => new Set(flaggedIndicesArray), [flaggedIndicesArray]);

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanJobId, setCleanJobId] = useState<string | null>(null);
  const [useAsync, setUseAsync] = useState(false);

  const [gbifLoading, setGbifLoading] = useState(false);
  const [gbifError, setGbifError] = useState<string | null>(null);
  const [gbifResult, setGbifResult] = useState<Record<string, unknown> | null>(null);

  const [dwcaLoading, setDwcaLoading] = useState(false);
  const [dwcaError, setDwcaError] = useState<string | null>(null);
  const [dwcaResult, setDwcaResult] = useState<Record<string, unknown> | null>(null);

  const [climateSource, setClimateSource] = useState<"worldclim" | "chelsa">("worldclim");
  const [climateRes, setClimateRes] = useState(10);
  const [climateBiovars, setClimateBiovars] = useState<number[]>([1, 4, 6, 12, 15, 18]);
  const [climateDownloadJob, setClimateDownloadJob] = useState<string | null>(null);
  const [availableBiovars, setAvailableBiovars] = useState<Set<number>>(new Set());

  const [cmip6Gcm, setCmip6Gcm] = useState("UKESM1-0-LL");
  const [cmip6Ssp, setCmip6Ssp] = useState("SSP2-4.5");
  const [cmip6Period, setCmip6Period] = useState("2041-2060");
  const [cmip6DownloadJob, setCmip6DownloadJob] = useState<string | null>(null);

  const [avgGcms, setAvgGcms] = useState<string[]>([]);
  const [avgDownloadJob, setAvgDownloadJob] = useState<string | null>(null);

  const [climateError, setClimateError] = useState<string | null>(null);

  const [scenarios, setScenarios] = useState<Array<Record<string, unknown>>>([]);
  const [scenariosLoading, setScenariosLoading] = useState(false);

  const onTabChange = useCallback((value: string) => {
    router.replace(`/data?tab=${value}`, { scroll: false });
  }, [router]);

  const toggleClimateBiovar = (id: number) => {
    setClimateBiovars((prev) => prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]);
  };

  const toggleAvgGcm = (id: string) => {
    setAvgGcms((prev) => prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]);
  };

  const handleClimateDownload = async () => {
    setClimateError(null);
    try {
      const data = await apiPost<Record<string, unknown>>("/api/v1/climate/download", {
        type: climateSource,
        res: climateRes,
        biovars: climateBiovars.join(","),
      });
      setClimateDownloadJob(data.jobId as string);
    } catch (err) {
      setClimateError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleCmip6Download = async () => {
    setClimateError(null);
    try {
      const data = await apiPost<Record<string, unknown>>("/api/v1/climate/download", {
        type: "cmip6",
        gcm: cmip6Gcm,
        ssp: cmip6Ssp,
        period: cmip6Period,
      });
      setCmip6DownloadJob(data.jobId as string);
    } catch (err) {
      setClimateError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleAvgDownload = async () => {
    if (avgGcms.length < 2) return;
    setClimateError(null);
    try {
      const data = await apiPost<Record<string, unknown>>("/api/v1/climate/download", {
        type: "cmip6_average",
        gcm_list: avgGcms,
        ssp: cmip6Ssp,
        period: cmip6Period,
        res: 10,
      });
      setAvgDownloadJob(data.jobId as string);
    } catch (err) {
      setClimateError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleDownloadComplete = useCallback((completedJobId: string) => {
    setClimateDownloadJob(prev => prev === completedJobId ? null : prev);
    setCmip6DownloadJob(prev => prev === completedJobId ? null : prev);
    setAvgDownloadJob(prev => prev === completedJobId ? null : prev);
    fetchScenarios();
  }, []);

  const fetchScenarios = useCallback(async () => {
    setScenariosLoading(true);
    try {
      const data = await apiGet<{ scenarios: Array<Record<string, unknown>> }>("/api/v1/climate/scenarios");
      setScenarios(data.scenarios || []);
    } catch {
    } finally {
      setScenariosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  useEffect(() => {
    const allBiovars = BIOVAR_CHOICES.map(b => b.id).join(",");
    apiGet<{ available: number[] }>(`/api/v1/climate/check?source=${climateSource}&res=${climateRes}&biovars=${encodeURIComponent(allBiovars)}`)
      .then(data => setAvailableBiovars(new Set(data.available || [])))
      .catch(() => setAvailableBiovars(new Set()));
  }, [climateSource, climateRes]);

  const handleDeleteScenario = (id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpload = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);
    setCleanResult(null);

    try {
      const result = await apiUpload<Record<string, unknown>>(
        "/api/v1/data/occurrences/upload", file, undefined, 600000
      );
      const data = (result.data as Record<string, unknown> | undefined) ?? result;
      setUploadResult(data);
      if (typeof data.file_path === "string" && data.file_path.length > 0) {
        setOccurrenceFilePath(data.file_path);
        setRecordCount(typeof data.n_rows === "number" ? data.n_rows : 0);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleFlagToggle = useCallback((idx: number, flagged: boolean) => {
    const current = useSDMStore.getState().flaggedIndices;
    setFlaggedIndicesArray(
      flagged
        ? [...current, idx]
        : current.filter(i => i !== idx)
    );
  }, [setFlaggedIndicesArray]);

  const handleClean = async () => {
    if (!uploadResult?.file_id) return;

    setCleanLoading(true);
    setCleanError(null);
    setFlaggedIndicesArray([]);

    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/clean", {
        file_id: uploadResult.file_id,
        min_source_records: 15,
        merge_small_sources: true,
        use_cc: false,
        cc_tests: "all",
        async: useAsync,
      });

      if (useAsync && result.jobId) {
        setCleanJobId(result.jobId as string);
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
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/search", {
        taxon, country, max_records: maxRecords,
      });
      setGbifResult(result);
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "GBIF search failed");
    } finally {
      setGbifLoading(false);
    }
  };

  const handleDwcaUpload = async (file: File) => {
    setDwcaLoading(true);
    setDwcaError(null);
    setDwcaResult(null);

    try {
      const result = await apiUpload<Record<string, unknown>>("/api/v1/data/occurrences/dwca", file);
      setDwcaResult(result);
    } catch (err) {
      setDwcaError(err instanceof Error ? err.message : "DwCA parsing failed");
    } finally {
      setDwcaLoading(false);
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

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-6">
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
          <TabsTrigger value="climate" className="flex items-center gap-1.5">
            <Cloud className="h-3.5 w-3.5" />
            Climate
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
              onUpload={handleDwcaUpload}
              loading={dwcaLoading}
              error={dwcaError}
            />
          </div>

          {dwcaError && (
            <div className="rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
              {dwcaError}
            </div>
          )}

          {dwcaResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Datasets</p>
                  <p className="mt-1 text-xl font-bold text-sdm-heading">{String(dwcaResult.n_datasets || 0)}</p>
                </div>
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Records</p>
                  <p className="mt-1 text-xl font-bold text-sdm-accent">{Number(dwcaResult.n_occurrences || 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">With coords</p>
                  <p className="mt-1 text-xl font-bold text-sdm-heading">{Number(dwcaResult.n_with_coords || 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">DOI</p>
                  <p className="mt-1 text-xs font-mono text-sdm-text truncate">{(dwcaResult.doi as string) || "—"}</p>
                </div>
              </div>

              {(dwcaResult.preview as Array<Record<string, unknown>> | undefined) && (dwcaResult.preview as Array<Record<string, unknown>>).length > 0 && (
                <PreviewTable data={dwcaResult.preview as Array<Record<string, unknown>>} title="DwC-A Preview (first 5 records)" />
              )}

              {typeof dwcaResult.file_path === "string" && (
                <div className="mt-3 flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-green-500">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>DwC-A parsed — {Number(dwcaResult.n_occurrences ?? 0).toLocaleString()} records extracted</span>
                  </div>
                  <Link href="/model" className="text-sm font-medium text-sdm-accent hover:underline">
                    Go to Model tab →
                  </Link>
                </div>
              )}
            </div>
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
                  onFlagToggle={handleFlagToggle}
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

        <TabsContent value="climate" className="space-y-4">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-sdm-heading mb-1">Current climate</h2>
              <p className="text-sm text-sdm-muted mb-4">Download WorldClim v2.1 or CHELSA v2.1 BIO layers.</p>

              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-sdm-text">
                    <input type="radio" checked={climateSource === "worldclim"} onChange={() => { setClimateSource("worldclim"); setClimateRes(10); }} />
                    WorldClim v2.1
                  </label>
                  <label className="flex items-center gap-2 text-sm text-sdm-text">
                    <input type="radio" checked={climateSource === "chelsa"} onChange={() => { setClimateSource("chelsa"); setClimateRes(0.5); }} />
                    CHELSA v2.1
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-sdm-text mb-1">Resolution</label>
                  <select value={climateRes} onChange={(e) => setClimateRes(Number(e.target.value))} className="rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                    {climateSource === "worldclim" ? (
                      <>
                        <option value={2.5}>2.5 arc-min (~5 km)</option>
                        <option value={5}>5 arc-min (~10 km)</option>
                        <option value={10}>10 arc-min (~20 km)</option>
                      </>
                    ) : (
                      <option value={0.5}>30 arc-seconds (~1 km)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-sdm-text mb-1">BIO variables</label>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-10 gap-1.5">
                    {BIOVAR_CHOICES.map((bio) => {
                      const isAvailable = availableBiovars.has(bio.id);
                      return (
                        <label
                          key={bio.id}
                          className={`flex items-center justify-center rounded border px-2 py-1.5 text-xs cursor-pointer transition-colors relative ${
                            climateBiovars.includes(bio.id)
                              ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                              : "border-sdm-border bg-sdm-surface-soft text-sdm-muted hover:border-sdm-accent/50"
                          }`}
                        >
                          {isAvailable && (
                            <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-green-500 translate-x-1/3 -translate-y-1/3" />
                          )}
                          <input type="checkbox" checked={climateBiovars.includes(bio.id)} onChange={() => toggleClimateBiovar(bio.id)} className="sr-only" />
                          {bio.label}
                        </label>
                      );
                    })}
                  </div>
                  {climateBiovars.length < 2 && (
                    <p className="text-xs text-sdm-danger mt-1">Select at least 2 BIO variables</p>
                  )}
                </div>

                {(() => {
                  const missingCount = climateBiovars.filter(b => !availableBiovars.has(b)).length;
                  const allPresent = missingCount === 0 && climateBiovars.length > 0;
                  return (
                    <button
                      onClick={handleClimateDownload}
                      disabled={climateDownloadJob !== null || climateBiovars.length < 2 || allPresent}
                      className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {climateDownloadJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {climateDownloadJob ? "Downloading..." : allPresent ? "All layers present" : `Download ${missingCount} missing`}
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="border-t border-sdm-border pt-6">
              <h2 className="text-lg font-semibold text-sdm-heading mb-1">Future climate (CMIP6)</h2>
              <p className="text-sm text-sdm-muted mb-4">Download CMIP6 climate projections for future scenario analysis.</p>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
                    <select value={cmip6Gcm} onChange={(e) => setCmip6Gcm(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                      {GCM_CHOICES.map((gcm) => (
                        <option key={gcm.id} value={gcm.id}>{gcm.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sdm-text mb-1">SSP</label>
                    <select value={cmip6Ssp} onChange={(e) => setCmip6Ssp(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                      {SSP_CHOICES.map((ssp) => (
                        <option key={ssp.id} value={ssp.id}>{ssp.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-sdm-text mb-1">Period</label>
                    <select value={cmip6Period} onChange={(e) => setCmip6Period(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                      {TIME_PERIOD_CHOICES.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleCmip6Download}
                  disabled={cmip6DownloadJob !== null}
                  className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cmip6DownloadJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {cmip6DownloadJob ? "Downloading..." : "Download scenario"}
                </button>

                <div className="border-t border-sdm-border pt-4 mt-4">
                  <h3 className="text-sm font-medium text-sdm-heading mb-2">Multi-GCM averaging</h3>
                  <p className="text-xs text-sdm-muted mb-2">Select at least 2 GCMs to compute ensemble mean.</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {GCM_CHOICES.map((gcm) => (
                      <label
                        key={gcm.id}
                        className={`px-2 py-1 rounded text-xs cursor-pointer border ${
                          avgGcms.includes(gcm.id)
                            ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                            : "border-sdm-border text-sdm-muted"
                        }`}
                      >
                        <input type="checkbox" checked={avgGcms.includes(gcm.id)} onChange={() => toggleAvgGcm(gcm.id)} className="sr-only" />
                        {gcm.label}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={handleAvgDownload}
                    disabled={avgDownloadJob !== null || avgGcms.length < 2}
                    className="inline-flex items-center gap-2 rounded-md bg-sdm-surface-soft border border-sdm-border px-4 py-2 text-sm font-medium text-sdm-text transition-colors hover:bg-sdm-surface disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {avgDownloadJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {avgDownloadJob ? "Averaging..." : "Average GCMs"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {climateError && (
            <div className="rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
              {climateError}
            </div>
          )}

          {(() => {
            const activeJob = climateDownloadJob || cmip6DownloadJob || avgDownloadJob;
            if (!activeJob) return null;
            return (
              <DownloadProgress
                jobId={activeJob}
                onComplete={() => handleDownloadComplete(activeJob)}
                onCancel={() => {
                  setClimateDownloadJob(null);
                  setCmip6DownloadJob(null);
                  setAvgDownloadJob(null);
                }}
              />
            );
          })()}

          <ScenarioList
            scenarios={scenarios as any}
            onRefresh={fetchScenarios}
            onDelete={handleDeleteScenario}
            loading={scenariosLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
