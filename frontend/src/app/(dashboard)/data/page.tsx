"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Globe, FileArchive, Wand2, Map, Cloud, CheckCircle2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useSDMStore } from "@/stores/sdm-store";
import { apiUpload, apiPost, apiGet, apiPatch } from "@/services/api";
import { FileUpload } from "@/components/data/file-upload";
import { PreviewTable } from "@/components/data/preview-table";
import { UploadTab } from "./upload-tab";
import { CleanTab } from "./clean-tab";
import { ClimateTab } from "./climate-tab";
import type { OccurrencePoint } from "./types";

const GbifSearch = dynamic(() => import("@/components/data/gbif-search"), { ssr: false });
const OccurrenceMap = dynamic(() => import("@/components/data/occurrence-map"), {
  ssr: false,
  loading: () => <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">Loading map...</div>,
});

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
  const titleCase = cleaned.split(" ").filter((w) => w.length > 0).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
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
  const _flaggedIndicesArray = useSDMStore((s) => s.flaggedIndices);
  const setFlaggedIndicesArray = useSDMStore((s) => s.setFlaggedIndices);

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadHistory, setUploadHistory] = useState<Array<Record<string, unknown>>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [cleanJobId, setCleanJobId] = useState<string | null>(null);
  const [useAsync, setUseAsync] = useState(false);
  const [useCc, setUseCc] = useState(true);

  useEffect(() => {
    if (!cleanJobId) return;
    const timeout = setTimeout(() => { setCleanError("Clean job timed out — check the admin diagnostics panel"); setCleanJobId(null); setCleanLoading(false); }, 600_000);
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
  const [gbifSaving, setGbifSaving] = useState(false);
  const [gbifSaved, setGbifSaved] = useState(false);

  const handleCancelDownload = useCallback(async () => {
    const active = climateDownloadJob || cmip6DownloadJob || avgDownloadJob;
    if (active) {
      try { await apiPost(`/api/v1/climate/cancel/${active}`); } catch { /* best-effort */ }
    }
    setClimateDownloadJob(null);
    setCmip6DownloadJob(null);
    setAvgDownloadJob(null);
  }, [climateDownloadJob, cmip6DownloadJob, avgDownloadJob]);

  const onTabChange = useCallback((value: string) => { router.replace(`/data?tab=${value}`, { scroll: false }); }, [router]);
  const toggleClimateBiovar = (id: number) => setClimateBiovars((prev) => prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]);
  const toggleAvgGcm = (id: string) => setAvgGcms((prev) => prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]);

  const handleClimateDownload = async () => {
    setClimateError(null);
    try { const data = await apiPost<Record<string, unknown>>("/api/v1/climate/download", { type: climateSource, res: climateRes, biovars: climateBiovars.join(",") }); setClimateDownloadJob(data.jobId as string); }
    catch (err) { setClimateError(err instanceof Error ? err.message : "Download failed"); }
  };

  const handleCmip6Download = async () => {
    setClimateError(null);
    try { const data = await apiPost<Record<string, unknown>>("/api/v1/climate/download", { type: "cmip6", gcm: cmip6Gcm, ssp: cmip6Ssp, period: cmip6Period }); setCmip6DownloadJob(data.jobId as string); }
    catch (err) { setClimateError(err instanceof Error ? err.message : "Download failed"); }
  };

  const handleAvgDownload = async () => {
    if (avgGcms.length < 2) return;
    setClimateError(null);
    try { const data = await apiPost<Record<string, unknown>>("/api/v1/climate/download", { type: "cmip6_average", gcm_list: avgGcms, ssp: cmip6Ssp, period: cmip6Period, res: 10 }); setAvgDownloadJob(data.jobId as string); }
    catch (err) { setClimateError(err instanceof Error ? err.message : "Download failed"); }
  };

  const clearDownloadJob = useCallback((jobId: string) => {
    setClimateDownloadJob(prev => prev === jobId ? null : prev);
    setCmip6DownloadJob(prev => prev === jobId ? null : prev);
    setAvgDownloadJob(prev => prev === jobId ? null : prev);
  }, []);

  const handleDownloadComplete = useCallback((completedJobId: string) => {
    clearDownloadJob(completedJobId);
    fetchScenarios();
  }, [clearDownloadJob]);

  const handleDownloadFailed = useCallback((failedJobId: string) => {
    clearDownloadJob(failedJobId);
    fetchScenarios();
  }, [clearDownloadJob]);

  const fetchScenarios = useCallback(async () => {
    setScenariosLoading(true);
    try { const data = await apiGet<{ scenarios: Array<Record<string, unknown>> }>("/api/v1/climate/scenarios"); setScenarios(data.scenarios || []); }
    catch { } finally { setScenariosLoading(false); }
  }, []);

  useEffect(() => { fetchScenarios(); }, [fetchScenarios]);

  useEffect(() => {
    const allBiovars = "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19";
    apiGet<{ available: number[] }>(`/api/v1/climate/check?source=${climateSource}&res=${climateRes}&biovars=${encodeURIComponent(allBiovars)}`)
      .then(data => setAvailableBiovars(new Set(data.available || []))).catch(() => setAvailableBiovars(new Set()));
  }, [climateSource, climateRes]);

  const handleDeleteScenario = async (id: string) => {
    try {
      await apiPost(`/api/v1/climate/delete/${id}`);
      setScenarios((prev) => prev.filter((s) => s.id !== id));
    } catch {
    }
  };

  const fetchUploads = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/occurrences/uploads");
      const mapped = (data.uploads || []).map((u) => ({
        file_id: u.file_path,
        file_name: u.filename,
        file_size: u.file_size,
        n_rows: u.n_rows,
        species: u.species,
        modified_at: u.created_at,
        cleaned: u.is_cleaned,
        cleaned_file_id: u.cleaned_file_path,
        cleaned_valid_records: u.cleaned_valid_records,
      }));
      setUploadHistory(mapped);
    } catch {
      setUploadHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const handleUpload = async (file: File) => {
    setUploadLoading(true); setUploadError(null); setUploadResult(null); setCleanResult(null); setCleanedOccurrence(null);
    try {
      const result = await apiUpload<Record<string, unknown>>(
        "/api/v1/data/occurrences/upload", file, undefined, 600000
      );
      const fileId = (result.file_id as string) || null;
      const nRows = typeof result.n_rows === "number" ? result.n_rows : 0;
      const detectedSpecies = (result.species_detected as string) || null;
      const pipelineRunId = (result.pipelineRunId as string) || null;
      setUploadResult(result); setPipelineRunId(pipelineRunId);
      if (fileId) {
        setOccurrenceFilePath(fileId);
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
      fetchUploads();
    }
  };

  const handleFlagToggle = useCallback((idx: number, flagged: boolean) => {
    const current = useSDMStore.getState().flaggedIndices;
    setFlaggedIndicesArray(flagged ? [...current, idx] : current.filter(i => i !== idx));
  }, [setFlaggedIndicesArray]);

  const handleClean = async () => {
    if (!uploadResult?.file_id) return;
    setCleanLoading(true); setCleanError(null); setFlaggedIndicesArray([]);
    const effectiveAsync = useAsync || useCc;
    const pipelineRunId = useSDMStore.getState().pipelineRunId;
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/clean", { file_id: uploadResult.file_id, species: useSDMStore.getState().species, min_source_records: 15, merge_small_sources: true, use_cc: useCc, cc_tests: "all", async: effectiveAsync, pipelineRunId }, { timeout: 600000 });
      if (effectiveAsync && (result.job_id || result.jobId)) {
        const jid = (result.job_id || result.jobId) as string; setCleanJobId(jid);
        const poll = async () => {
          for (let i = 0; i < 150; i++) {
            try { const status = await apiGet<Record<string, unknown>>(`/api/v1/data/jobs/${jid}`); const s = status?.status as string; if (s === "completed") { handleCleanComplete(status?.result as Record<string, unknown> || status); return; } if (s === "failed") { setCleanError((status?.error as string) || "Clean job failed"); setCleanJobId(null); setCleanLoading(false); return; } }
            catch { } await new Promise(r => setTimeout(r, 2000));
          }
          setCleanError("Clean job timed out after 5 minutes"); setCleanJobId(null); setCleanLoading(false);
        };
        poll();
      } else {
        setCleanResult(result);
        setCleanedOccurrence({ filePath: (result.cleaned_file_id as string) || "", df: (result.cleaned_records as Record<string, unknown>[]) || [], sourceCounts: (result.source_counts as Record<string, number>) || {}, nAbsentExcluded: (result.n_absent_excluded as number) || 0, originalRows: (result.original_rows as number) || 0, validRecords: (result.valid_records as number) || 0 });
        setRecordCount((result.valid_records as number) || 0);
        const rp = (result.pipelineRunId as string) || pipelineRunId; if (rp) setPipelineRunId(rp);
      }
    } catch (err) { setCleanError(err instanceof Error ? err.message : "Clean failed"); } finally { if (!effectiveAsync) setCleanLoading(false); }
  };

  const handleCleanComplete = (result: Record<string, unknown>) => {
    if ((result as any)?.status === "error") { setCleanError((result as any)?.error || "Clean job failed"); setCleanJobId(null); setCleanLoading(false); return; }
    const cleanData = (result as any)?.data ?? result; const finalData = "cleaned_file_id" in cleanData ? cleanData : (cleanData as any)?.data ?? cleanData;
    setCleanResult(finalData); const cleanedRowCount = (finalData.valid_records as number) || 0;
    setCleanedOccurrence({ filePath: (finalData.cleaned_file_id as string) || "", df: (finalData.cleaned_records as Record<string, unknown>[]) || [], sourceCounts: (finalData.source_counts as Record<string, number>) || {}, nAbsentExcluded: (finalData.n_absent_excluded as number) || 0, originalRows: (finalData.original_rows as number) || 0, validRecords: cleanedRowCount });
    setRecordCount(cleanedRowCount);
    const pipelineRunId = useSDMStore.getState().pipelineRunId; if (finalData.pipelineRunId) setPipelineRunId(finalData.pipelineRunId as string); else if (pipelineRunId) setPipelineRunId(pipelineRunId);
    setCleanJobId(null); setCleanLoading(false);
    const currentFileId = useSDMStore.getState().uploadResult?.file_id; if (currentFileId && finalData.cleaned_file_id) apiPatch(`/api/v1/data/uploads/${encodeURIComponent(currentFileId as string)}`, { cleaned: true, cleaned_file_path: finalData.cleaned_file_id }).catch(() => console.warn("[data] Failed to update upload cleaned status"));
  };

  const handleGbifSearch = async (taxon: string, country: string, maxRecords: number) => {
    setGbifLoading(true); setGbifError(null); setGbifResult(null);
    try { const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/search", { taxon, country, max_records: maxRecords }); setGbifResult(result); }
    catch (err) { setGbifError(err instanceof Error ? err.message : "GBIF search failed"); } finally { setGbifLoading(false); }
  };

  const handleGbifSave = async () => {
    if (!gbifResult) return; setGbifSaving(true);
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/save", { taxon: gbifResult.taxon, country: gbifResult.country, max_records: gbifResult.max_records });
      if (typeof result.file_path === "string") { setOccurrenceFilePath(result.file_path); setRecordCount(Number(result.n_rows || 0)); useSDMStore.getState().setSpecies(String(gbifResult.taxon || "Untitled species")); setUploadResult(result); setPipelineRunId((result.pipelineRunId as string) || null); setGbifSaved(true); }
    } catch (err) { setGbifError(err instanceof Error ? err.message : "Failed to save GBIF records"); } finally { setGbifSaving(false); }
  };

  const handleDwcaUpload = async (file: File) => {
    setDwcaLoading(true); setDwcaError(null); setDwcaResult(null);
    try {
      const result = await apiUpload<Record<string, unknown>>("/api/v1/data/occurrences/dwca", file, undefined, 600000);
      setDwcaResult(result); setUploadResult(result); setPipelineRunId((result.pipelineRunId as string) || null);
      if (typeof result.file_path === "string") { setOccurrenceFilePath(result.file_path); setRecordCount(Number(result.n_returned || result.n_rows || result.n_records || 0)); }
    } catch (err) { setDwcaError(err instanceof Error ? err.message : "DwCA parsing failed"); } finally { setDwcaLoading(false); }
  };

  const cleanPreview = cleanResult?.cleaned_records as OccurrencePoint[] | undefined;
  const gbifPreview = gbifResult?.preview as Record<string, unknown>[] | undefined;
  const uploadPreview = uploadResult?.preview as Record<string, unknown>[] | undefined;
  const handleSelectUpload = (file: Record<string, unknown>) => {
    const fp = file.file_id as string;
    if (!fp) return;
    setUploadResult({ ...file, file_id: fp, file_path: fp });
    setOccurrenceFilePath(fp);
    setRecordCount(Number(file.n_rows || 0));
    setPipelineRunId(null);
    setCleanResult(null);
    if (Boolean(file.cleaned) && file.cleaned_file_id) {
      setCleanedOccurrence({
        filePath: file.cleaned_file_id as string,
        df: [],
        sourceCounts: {},
        nAbsentExcluded: 0,
        originalRows: Number(file.n_rows || 0),
        validRecords: Number(file.cleaned_valid_records || file.n_rows || 0),
      });
    } else {
      setCleanedOccurrence(null);
    }
    const species = file.species as string;
    if (species && species !== "—") useSDMStore.getState().setSpecies(species);
  };
  const previousUploads = uploadHistory;
  const previousUploadsLoading = historyLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Occurrence Data</h1>
        <p className="text-sdm-muted mt-1">Upload occurrence records, fetch from GBIF, or parse a Darwin Core Archive.</p>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 w-full max-w-2xl">
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

        {activeTab === "upload" && (
          <UploadTab uploadResult={uploadResult} uploadLoading={uploadLoading} uploadError={uploadError}
            onUpload={handleUpload} onSelectUpload={handleSelectUpload} onTabChange={onTabChange}
            previousUploads={previousUploads} previousUploadsLoading={previousUploadsLoading} />
        )}

          {gbifPreview && gbifPreview.length > 0 && <PreviewTable data={gbifPreview} title="GBIF Preview (first 5 records)" />}
            {gbifResult && typeof gbifResult.n_records === "number" && gbifResult.n_records > 0 && (
              <div className="space-y-3">
                {gbifSaved ? (
                  <div className="flex items-center justify-between rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-sdm-warning"><span>{Number(gbifResult.n_records).toLocaleString()} GBIF records saved — clean before modeling</span></div>
                    <button onClick={() => onTabChange("clean")} className="text-sm font-medium text-sdm-accent hover:underline">Clean data →</button>
                  </div>
                ) : (
                  <button onClick={handleGbifSave} disabled={gbifSaving}
                    className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50">
                    Save {Number(gbifResult.n_records).toLocaleString()} records for modeling
                  </button>
                )}
              </div>
            )}

        {activeTab === "dwca" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
              <h2 className="text-lg font-semibold text-sdm-heading mb-4">Parse Darwin Core Archive</h2>
              <p className="text-sm text-sdm-muted mb-4">Upload a GBIF bulk download ZIP file. The archive is parsed automatically, extracting occurrence data and dataset DOI for provenance.</p>
              <FileUpload onUpload={handleDwcaUpload} loading={dwcaLoading} error={dwcaError} />
            </div>
            {dwcaError && <div className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">{dwcaError}</div>}
            {dwcaResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4"><p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Datasets</p><p className="mt-1 text-xl font-bold text-sdm-heading">{String(((dwcaResult as any).datasets as Array<unknown>)?.length ?? 0)}</p></div>
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4"><p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Returned</p><p className="mt-1 text-xl font-bold text-sdm-accent">{Number((dwcaResult as any).n_returned ?? 0).toLocaleString()}</p></div>
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4"><p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">Raw</p><p className="mt-1 text-xl font-bold text-sdm-heading">{Number((dwcaResult as any).n_raw ?? 0).toLocaleString()}</p></div>
                  <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4"><p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">DOI</p><p className="mt-1 text-xs font-mono text-sdm-text truncate">{((dwcaResult as any).doi as string) || "—"}</p></div>
                </div>
                {(dwcaResult as any).preview?.length > 0 && <PreviewTable data={(dwcaResult as any).preview} title="DwC-A Preview (first 5 records)" />}
                {(dwcaResult as any).file_path && (
                  <div className="flex items-center justify-between rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-sdm-warning"><span>DwC-A parsed — {Number((dwcaResult as any).n_returned ?? 0).toLocaleString()} records. Clean before modeling.</span></div>
                    <button onClick={() => onTabChange("clean")} className="text-sm font-medium text-sdm-accent hover:underline">Clean data →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "clean" && (
          <CleanTab uploadResult={uploadResult} cleanResult={cleanResult} cleanLoading={cleanLoading}
            cleanError={cleanError} cleanJobId={cleanJobId} useAsync={useAsync} useCc={useCc}
             onSetUseAsync={setUseAsync} onSetUseCc={setUseCc}
            onClean={handleClean} onCleanComplete={handleCleanComplete} onFlagToggle={handleFlagToggle}
            onRunModel={() => router.push("/model")} />
        )}

        {activeTab === "map" && (
          <div className="space-y-4">
            {cleanPreview && cleanPreview.length > 0 ? (
              <>
                <OccurrenceMap points={cleanPreview}  />
                <div className="flex items-center gap-4 text-sm text-sdm-muted">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-sdm-accent-blue" /> Clean</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-sdm-danger" /> Flagged</span>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">Clean occurrence data first to see the map.</div>
            )}
          </div>
        )}

        {activeTab === "climate" && (
          <ClimateTab climateSource={climateSource} climateRes={climateRes} climateBiovars={climateBiovars}
            availableBiovars={availableBiovars} climateDownloadJob={climateDownloadJob}
            cmip6Gcm={cmip6Gcm} cmip6Ssp={cmip6Ssp} cmip6Period={cmip6Period} cmip6DownloadJob={cmip6DownloadJob}
            avgGcms={avgGcms} avgDownloadJob={avgDownloadJob} climateError={climateError}
            scenarios={scenarios} scenariosLoading={scenariosLoading}
            onSetClimateSource={setClimateSource} onSetClimateRes={setClimateRes}
            onToggleClimateBiovar={toggleClimateBiovar} onClimateDownload={handleClimateDownload}
            onSetCmip6Gcm={setCmip6Gcm} onSetCmip6Ssp={setCmip6Ssp} onSetCmip6Period={setCmip6Period}
            onCmip6Download={handleCmip6Download} onToggleAvgGcm={toggleAvgGcm} onAvgDownload={handleAvgDownload}
            onDownloadComplete={handleDownloadComplete} onDownloadFailed={handleDownloadFailed} onCancelDownload={handleCancelDownload}
            onFetchScenarios={fetchScenarios} onDeleteScenario={handleDeleteScenario} />
        )}
      </Tabs>
    </div>
  );
}
