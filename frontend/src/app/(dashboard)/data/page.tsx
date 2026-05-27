"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { FileUpload } from "@/components/data/file-upload";
import { PreviewTable } from "@/components/data/preview-table";
import { SourceCounts } from "@/components/data/source-counts";
import { JobProgress } from "@/components/jobs/job-progress";
import { DownloadProgress } from "@/components/climate/download-progress";
import { ScenarioList } from "@/components/climate/scenario-list";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Globe, FileArchive, Wand2, Map, Cloud, Loader2, CheckCircle2, Download, AlertTriangle, Trash2, HardDrive } from "lucide-react";
import { useSDMStore } from "@/stores/sdm-store";
import { apiUpload, apiPost, apiGet, apiPatch, apiDelete } from "@/services/api";
import { BIOVAR_CHOICES, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";

const GbifSearch = dynamic(() => import("@/components/data/gbif-search").then(m => m.GbifSearch), { ssr: false });
const CleaningTable = dynamic(() => import("@/components/data/cleaning-table").then(m => m.CleaningTable), { ssr: false });
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

function extractSpeciesFromFilename(filename: string): string | null {
  const base = filename.replace(/\.(csv|tsv|txt|zip)$/i, "");
  const cleaned = base.replace(/[_-]/g, " ").trim();
  const titleCase = cleaned
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  if (titleCase.length < 3 || titleCase === cleaned.toUpperCase()) return null;
  return titleCase;
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
  const setCleanedOccurrence = useSDMStore((s) => s.setCleanedOccurrence);
  const setPipelineRunId = useSDMStore((s) => s.setPipelineRunId);
  const flaggedIndicesArray = useSDMStore((s) => s.flaggedIndices);
  const setFlaggedIndicesArray = useSDMStore((s) => s.setFlaggedIndices);
  const flaggedIndices = useMemo(() => new Set(flaggedIndicesArray), [flaggedIndicesArray]);

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previousUploads, setPreviousUploads] = useState<Array<Record<string, unknown>>>([]);
  const [previousUploadsLoading, setPreviousUploadsLoading] = useState(false);

  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanJobId, setCleanJobId] = useState<string | null>(null);
  const [useAsync, setUseAsync] = useState(false);
  const [useCc, setUseCc] = useState(true);

  // Timeout fallback: if async clean doesn't complete within 10 min, reset loading state
  useEffect(() => {
    if (!cleanJobId) return;
    const timeout = setTimeout(() => {
      setCleanError("Clean job timed out — check the admin diagnostics panel");
      setCleanJobId(null);
      setCleanLoading(false);
    }, 600_000);
    return () => clearTimeout(timeout);
  }, [cleanJobId]);

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

  // File management state
  const [storageInfo, setStorageInfo] = useState<{
    quota_bytes: number;
    used_bytes: number;
    available_bytes: number;
    quota_mb: number;
    used_mb: number;
    available_mb: number;
    pct_used: number;
  } | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{
    file_id: string;
    file_name: string;
    file_size: number;
    n_rows: number;
    modified_at: string;
    cleaned: boolean;
    deleting?: boolean;
  }>>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const loadStorageInfo = useCallback(async () => {
    try {
      const [storage, uploads] = await Promise.all([
        apiGet<typeof storageInfo>("/api/v1/data/storage"),
        apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/uploads"),
      ]);
      setStorageInfo(storage);
      setUploadedFiles((uploads.uploads || []).map((f: Record<string, unknown>) => ({
        file_id: f.file_id as string,
        file_name: f.file_name as string,
        file_size: f.file_size as number,
        n_rows: f.n_rows as number,
        modified_at: f.modified_at as string,
        cleaned: f.cleaned as boolean,
        deleting: false,
      })));
    } catch {
      // silently fail
    }
  }, []);

  const handleDeleteFile = useCallback(async (fileId: string) => {
    setUploadedFiles((prev) => prev.map((f) => f.file_id === fileId ? { ...f, deleting: true } : f));
    try {
      await apiDelete(`/api/v1/data/uploads/${encodeURIComponent(fileId)}`);
      await loadStorageInfo();
    } catch {
      setUploadedFiles((prev) => prev.map((f) => f.file_id === fileId ? { ...f, deleting: false } : f));
    }
  }, [loadStorageInfo]);

  // Load file management data when the tab is active
  useEffect(() => {
    if (activeTab === "files") {
      setFilesLoading(true);
      loadStorageInfo().finally(() => setFilesLoading(false));
    }
  }, [activeTab, loadStorageInfo]);

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

  useEffect(() => {
    setPreviousUploadsLoading(true);
    apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/uploads")
      .then((data) => setPreviousUploads(data.uploads || []))
      .catch((err) => console.warn("[uploads] Failed to fetch previous uploads:", err))
      .finally(() => setPreviousUploadsLoading(false));
  }, []);

  const handleDeleteScenario = (id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpload = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);
    setCleanResult(null);
    setCleanedOccurrence(null);

    try {
      const result = await apiUpload<Record<string, unknown>>(
        "/api/v1/data/occurrences/upload", file, undefined, 600000
      );
      const filePath = (result.file_path as string) || null;
      const nRows = typeof result.n_rows === "number" ? result.n_rows : 0;
      const detectedSpecies = (result.species_detected as string) || null;
      const pipelineRunId = (result.pipelineRunId as string) || null;

      setUploadResult(result);
      setPipelineRunId(pipelineRunId);
      if (filePath) {
        setOccurrenceFilePath(filePath);
        setRecordCount(nRows);
        if (detectedSpecies) {
          useSDMStore.getState().setSpecies(detectedSpecies);
        } else {
          const extracted = extractSpeciesFromFilename(file.name);
          if (extracted) {
            useSDMStore.getState().setSpecies(extracted);
          }
        }
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleSelectUpload = (file: Record<string, unknown>) => {
    const filePath = file.file_id as string;
    const fileName = file.file_name as string;
    const nRows = (file.n_rows as number) || 0;

    setUploadResult({ file_id: filePath, file_path: filePath, file_name: fileName, n_rows: nRows });
    setPipelineRunId(null);
    setCleanResult(null);

    if (file.cleaned && file.cleaned_file_id) {
      // Bypass cleaning — file was already cleaned
      setCleanedOccurrence({
        filePath: file.cleaned_file_id as string,
        df: [],
        sourceCounts: {},
        nAbsentExcluded: 0,
        originalRows: nRows,
        validRecords: nRows,
      });
    } else {
      setCleanedOccurrence(null);
    }

    if (filePath) {
      setOccurrenceFilePath(filePath);
      setRecordCount(nRows);
      const extracted = extractSpeciesFromFilename(fileName);
      if (extracted) {
        useSDMStore.getState().setSpecies(extracted);
      }
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

    const effectiveAsync = useAsync || useCc;
    const pipelineRunId = useSDMStore.getState().pipelineRunId;
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/clean", {
        file_id: uploadResult.file_id,
        species: useSDMStore.getState().species,
        min_source_records: 15,
        merge_small_sources: true,
        use_cc: useCc,
        cc_tests: "all",
        async: effectiveAsync,
        pipelineRunId,
      }, { timeout: 600000 });

      if (effectiveAsync && (result.job_id || result.jobId)) {
        const jid = (result.job_id || result.jobId) as string;
        setCleanJobId(jid);

        // Poll job status via REST (clean jobs don't emit SSE events)
        const poll = async () => {
          const maxPolls = 150; // 5 minutes at 2s intervals
          for (let i = 0; i < maxPolls; i++) {
            try {
              const status = await apiGet<Record<string, unknown>>(`/api/v1/data/jobs/${jid}`);
              const s = status?.status as string;
              if (s === "completed") {
                handleCleanComplete(status?.result as Record<string, unknown> || status);
                return;
              }
              if (s === "failed") {
                setCleanError((status?.error as string) || "Clean job failed");
                setCleanJobId(null);
                setCleanLoading(false);
                return;
              }
            } catch {
              // Continue polling on transient errors
            }
            await new Promise(r => setTimeout(r, 2000));
          }
          setCleanError("Clean job timed out after 5 minutes");
          setCleanJobId(null);
          setCleanLoading(false);
        };
        poll();
      } else {
        setCleanResult(result);
        const cleanedRowCount = (result.valid_records as number) || 0;
        setCleanedOccurrence({
          filePath: (result.cleaned_file_id as string) || "",
          df: (result.cleaned_records as Record<string, unknown>[]) || [],
          sourceCounts: (result.source_counts as Record<string, number>) || {},
          nAbsentExcluded: (result.n_absent_excluded as number) || 0,
          originalRows: (result.original_rows as number) || 0,
          validRecords: cleanedRowCount,
        });
        setRecordCount(cleanedRowCount);
        const respPipelineRunId = (result.pipelineRunId as string) || pipelineRunId;
        if (respPipelineRunId) setPipelineRunId(respPipelineRunId);
      }
    } catch (err) {
      setCleanError(err instanceof Error ? err.message : "Clean failed");
    } finally {
      if (!effectiveAsync) {
        setCleanLoading(false);
      }
    }
  };

  const handleCleanComplete = (result: Record<string, unknown>) => {
    if ((result as any)?.status === "error") {
      setCleanError((result as any)?.error || "Clean job failed");
      setCleanJobId(null);
      setCleanLoading(false);
      return;
    }

    const cleanData = (result as any)?.data ?? result;
    const hasCleanFields = "cleaned_file_id" in cleanData;
    const finalData = hasCleanFields ? cleanData : (cleanData as any)?.data ?? cleanData;

    setCleanResult(finalData);
    const cleanedRowCount = (finalData.valid_records as number) || 0;
    setCleanedOccurrence({
      filePath: (finalData.cleaned_file_id as string) || "",
      df: (finalData.cleaned_records as Record<string, unknown>[]) || [],
      sourceCounts: (finalData.source_counts as Record<string, number>) || {},
      nAbsentExcluded: (finalData.n_absent_excluded as number) || 0,
      originalRows: (finalData.original_rows as number) || 0,
      validRecords: cleanedRowCount,
    });
    setRecordCount(cleanedRowCount);
    const pipelineRunId = useSDMStore.getState().pipelineRunId;
    if (finalData.pipelineRunId) setPipelineRunId(finalData.pipelineRunId as string);
    else if (pipelineRunId) setPipelineRunId(pipelineRunId);
    setCleanJobId(null);
    setCleanLoading(false);

    // Mark the upload as cleaned in the backend
    const currentFileId = useSDMStore.getState().uploadResult?.file_id;
    if (currentFileId && finalData.cleaned_file_id) {
      apiPatch(`/api/v1/data/uploads/${encodeURIComponent(currentFileId as string)}`, {
        cleaned: true,
        cleaned_file_path: finalData.cleaned_file_id,
      }).catch(() => {});
    }
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

  const [gbifSaving, setGbifSaving] = useState(false);
  const [gbifSaved, setGbifSaved] = useState(false);

  const handleGbifSave = async () => {
    if (!gbifResult) return;
    setGbifSaving(true);
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/save", {
        taxon: gbifResult.taxon,
        country: gbifResult.country,
        max_records: gbifResult.max_records,
      });
      if (typeof result.file_path === "string") {
        setOccurrenceFilePath(result.file_path);
        setRecordCount(Number(result.n_rows || 0));
        useSDMStore.getState().setSpecies(String(gbifResult.taxon || "Untitled species"));
        setUploadResult(result);
        setPipelineRunId((result.pipelineRunId as string) || null);
        setGbifSaved(true);
      }
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "Failed to save GBIF records");
    } finally {
      setGbifSaving(false);
    }
  };

  const handleDwcaUpload = async (file: File) => {
    setDwcaLoading(true);
    setDwcaError(null);
    setDwcaResult(null);

    try {
      const result = await apiUpload<Record<string, unknown>>("/api/v1/data/occurrences/dwca", file, undefined, 600000);
      setDwcaResult(result);
      setUploadResult(result);
      setPipelineRunId((result.pipelineRunId as string) || null);
      if (typeof result.file_path === "string") {
        setOccurrenceFilePath(result.file_path);
        setRecordCount(Number(result.n_returned || result.n_rows || result.n_records || 0));
      }
    } catch (err) {
      setDwcaError(err instanceof Error ? err.message : "DwCA parsing failed");
    } finally {
      setDwcaLoading(false);
    }
  };

  const uploadPreview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const gbifPreview = gbifResult?.preview as Array<Record<string, unknown>> | undefined;
  const cleanPreview = cleanResult?.cleaned_records as OccurrencePoint[] | undefined;
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
        <TabsList className="grid w-full max-w-2xl grid-cols-7">
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
          <TabsTrigger value="files" className="flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            Manage Files
          </TabsTrigger>
        </TabsList>

        {activeTab === "upload" && (
          <div className="space-y-4">
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
              <div className="mt-3 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Upload complete — {Number(uploadResult.n_rows ?? 0).toLocaleString()} records. Clean before modeling.</span>
                </div>
                <button onClick={() => onTabChange("clean")} className="text-sm font-medium text-sdm-accent hover:underline">
                  Clean data →
                </button>
              </div>
            )}

            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
              <h3 className="text-sm font-semibold text-sdm-heading mb-3">Previous uploads</h3>
              {previousUploadsLoading ? (
                <div className="flex items-center gap-2 text-sm text-sdm-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : previousUploads.length === 0 ? (
                <p className="text-sm text-sdm-muted">No previous uploads found.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {previousUploads.map((f) => {
                    const fileName = f.file_name as string;
                    const fileSize = f.file_size as number;
                    const nRows = f.n_rows as number;
                    const modifiedAt = f.modified_at as string;
                    const isSelected = uploadResult?.file_id === f.file_id;
                    const sizeStr = fileSize > 1024 * 1024
                      ? `${(fileSize / 1024 / 1024).toFixed(1)} MB`
                      : `${(fileSize / 1024).toFixed(0)} KB`;
                    return (
                      <div
                        key={f.file_id as string}
                        className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-sm transition-colors ${
                          isSelected
                            ? "border-sdm-accent bg-sdm-accent/5"
                            : "border-sdm-border bg-sdm-surface-soft hover:border-sdm-accent/50"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sdm-text truncate">
                            {fileName}
                            {(f as any).cleaned && (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-500">
                                Cleaned
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-sdm-muted">
                            {sizeStr}
                            {nRows > 0 && ` · ${nRows.toLocaleString()} rows`}
                            {modifiedAt && ` · ${new Date(modifiedAt).toLocaleString()}`}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="shrink-0 text-xs font-medium text-sdm-accent ml-3">Selected</span>
                        ) : (
                          <button
                            onClick={() => handleSelectUpload(f)}
                            className="shrink-0 rounded border border-sdm-border bg-sdm-surface px-3 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface-soft ml-3"
                          >
                            Use
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "gbif" && (
          <div className="space-y-4">
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

            {gbifResult && typeof gbifResult.n_records === "number" && gbifResult.n_records > 0 && (
              <div className="space-y-3">
                {gbifSaved ? (
                  <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-amber-500">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{Number(gbifResult.n_records).toLocaleString()} GBIF records saved — clean before modeling</span>
                    </div>
                    <button onClick={() => onTabChange("clean")} className="text-sm font-medium text-sdm-accent hover:underline">
                      Clean data →
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleGbifSave}
                    disabled={gbifSaving}
                    className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {gbifSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {gbifSaving ? "Saving..." : `Save ${Number(gbifResult.n_records).toLocaleString()} records for modeling`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "dwca" && (
          <div className="space-y-4">
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
                    <p className="mt-1 text-xl font-bold text-sdm-heading">{String((dwcaResult.datasets as Array<unknown>)?.length ?? 0)}</p>
                  </div>
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Returned</p>
                    <p className="mt-1 text-xl font-bold text-sdm-accent">{Number(dwcaResult.n_returned ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Raw</p>
                    <p className="mt-1 text-xl font-bold text-sdm-heading">{Number(dwcaResult.n_raw ?? 0).toLocaleString()}</p>
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
                  <div className="mt-3 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-amber-500">
                      <AlertTriangle className="h-4 w-4" />
                      <span>DwC-A parsed — {Number(dwcaResult.n_returned ?? 0).toLocaleString()} records. Clean before modeling.</span>
                    </div>
                    <button onClick={() => onTabChange("clean")} className="text-sm font-medium text-sdm-accent hover:underline">
                      Clean data →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "clean" && (
          <div className="space-y-4">
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
                <label className="flex items-center gap-2 text-sm text-sdm-text">
                  <input
                    type="checkbox"
                    checked={useCc}
                    onChange={(e) => setUseCc(e.target.checked)}
                    className="rounded border-sdm-border bg-sdm-surface-soft"
                  />
                  CoordinateCleaner
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
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
                    <div className="flex items-center gap-2 text-sm text-sdm-muted">
                      <Loader2 className="h-4 w-4 animate-spin text-sdm-accent" />
                      Cleaning in background...
                    </div>
                  </div>
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
                    <p className="mt-1 text-xl font-bold text-sdm-accent">{(Number(cleanResult.valid_records) || 0).toLocaleString()}</p>
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

                {sourceCounts && <SourceCounts counts={sourceCounts} total={Number(cleanResult.valid_records) || 0} />}

                {cleanPreview && cleanPreview.length > 0 && (
                  <CleaningTable
                    data={cleanPreview}
                    title="Cleaned records"
                    onFlagToggle={handleFlagToggle}
                  />
                )}

                {(Number(cleanResult.valid_records) || 0) > 0 ? (
                  <div className="flex items-center justify-between rounded-md border border-indigo-500/30 bg-indigo-500/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-indigo-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Cleaned: {(Number(cleanResult.valid_records) || 0).toLocaleString()} valid records ready</span>
                    </div>
                    <button onClick={() => router.push("/model")} className="text-sm font-medium text-sdm-accent hover:underline">
                      Run SDM with cleaned data →
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-red-500">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Cleaning produced 0 valid records — check your data</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "map" && (
          <div className="space-y-4">
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
          </div>
        )}

        {activeTab === "climate" && (
          <div className="space-y-4">
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
          </div>
        )}
        {activeTab === "files" && (
          <div className="space-y-6">
            {(() => {
              if (filesLoading && !storageInfo) {
                return (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-sdm-muted" />
                  </div>
                );
              }

              const pct = storageInfo?.pct_used ?? 0;
              const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-sdm-accent";

              return (
                <>
                  {/* Storage usage card */}
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-sdm-muted" />
                        <h2 className="text-lg font-semibold text-sdm-heading">Storage</h2>
                      </div>
                      <button
                        onClick={loadStorageInfo}
                        className="text-xs text-sdm-muted hover:text-sdm-accent transition-colors"
                      >
                        Refresh
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-sdm-muted">
                          {storageInfo?.used_mb ?? 0} MB used of {storageInfo?.quota_mb ?? 500} MB
                        </span>
                        <span className={pct > 90 ? "text-red-500 font-medium" : "text-sdm-muted"}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-sdm-surface-soft overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Uploaded files list */}
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface">
                    <div className="border-b border-sdm-border px-6 py-4">
                      <h2 className="text-lg font-semibold text-sdm-heading">Uploaded occurrence files</h2>
                      <p className="text-sm text-sdm-muted mt-1">
                        Delete files you no longer need to free up storage space.
                      </p>
                    </div>

                    {uploadedFiles.length === 0 ? (
                      <div className="px-6 py-8 text-center text-sm text-sdm-muted">
                        No uploaded files yet.
                      </div>
                    ) : (
                      <div className="divide-y divide-sdm-border">
                        {uploadedFiles.map((file) => (
                          <div key={file.file_id} className="flex items-center justify-between px-6 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-sdm-text truncate">{file.file_name}</p>
                              <p className="text-xs text-sdm-muted">
                                {(file.file_size / (1024 * 1024)).toFixed(1)} MB
                                {file.n_rows > 0 && ` · ${file.n_rows.toLocaleString()} records`}
                                {file.cleaned && " · cleaned"}
                                {` · ${new Date(file.modified_at).toLocaleDateString()}`}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDeleteFile(file.file_id)}
                              disabled={file.deleting}
                              className="ml-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 border border-red-500/30 transition-colors disabled:opacity-50"
                            >
                              {file.deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              {file.deleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

          </div>
        )}
      </Tabs>
    </div>
  );
}
