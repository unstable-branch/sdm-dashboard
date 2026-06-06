"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Cloud, Layers, Map, LayoutDashboard } from "lucide-react";
import { useSDMStore } from "@/stores/sdm-store";
import { useSettingsStore } from "@/stores/settings-store";
import { apiUpload, apiPost, apiGet, apiDelete } from "@/services/api";
import { UploadTab } from "./upload-tab";
import { ClimateTab } from "./climate-tab";
import { CovariateTab } from "./covariate-tab";
import { BoundaryTab } from "./boundary-tab";
import { OverviewTab } from "./overview-tab";
import type { UploadFile, ClimateScenarioResponse } from "@/services/types";
import type { WorkspaceFile } from "./types";

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
  const parts = cleaned.split(" ").filter((w) => w.length > 0);
  if (parts.length < 2) return null;
  if (parts.every((w) => w === w.toUpperCase())) return null;
  const genus = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  const species = parts[1].toLowerCase();
  const rest = parts.slice(2).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return rest ? `${genus} ${species} ${rest}` : `${genus} ${species}`;
}

function DataPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "upload";

  const setOccurrenceFilePath = useSDMStore((s) => s.setOccurrenceFilePath);
  const setRecordCount = useSDMStore((s) => s.setRecordCount);
  const setCleanedOccurrence = useSDMStore((s) => s.setCleanedOccurrence);
  const setPipelineRunId = useSDMStore((s) => s.setPipelineRunId);
  const uploadResult = useSDMStore((s) => s.uploadResult);
  const setUploadResult = useSDMStore((s) => s.setUploadResult);
  const cleanResult = useSDMStore((s) => s.cleanResult);
  const setCleanResult = useSDMStore((s) => s.setCleanResult);
  const species = useSDMStore((s) => s.species);
  const recordCount = useSDMStore((s) => s.recordCount);
  const settings = useSettingsStore((s) => s.settings);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  useEffect(() => { if (!settings) fetchSettings(); }, []);
  const hasGbifCredentials = !!(settings?.gbifUsername && settings?.gbifEmail);
  const hasAlaCredentials = !!settings?.hasAlaApiKey;

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadHistory, setUploadHistory] = useState<UploadFile[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Clean data from global store when leaving data page
  useEffect(() => {
    return () => {
      useSDMStore.getState().setOccurrenceData(null);
      useSDMStore.getState().setUploadResult(null);
      useSDMStore.getState().setCleanResult(null);
    };
  }, []);

  // ── Workspace state (persisted in Zustand store across navigations) ──
  const workspaceFiles = useSDMStore((s) => s.workspaceFiles);
  const setWorkspaceFiles = useSDMStore((s) => s.setWorkspaceFiles);

  const handleWorkspaceAdd = useCallback((file: UploadFile, speciesOverride?: string) => {
    setWorkspaceFiles((prev) => {
      if (prev.some(f => f.fileId === file.file_id)) return prev;
      return [...prev, {
        id: crypto.randomUUID(),
        fileId: file.file_id,
        fileName: file.file_name,
        filePath: file.file_id,
        fileFormat: file.format,
        fileRows: file.n_rows,
        fileCleaned: file.cleaned,
        fileCleanedFileId: file.cleaned_file_id,
        cleanedFileId: file.cleaned_file_id,
        cleanValidRecords: file.cleaned_valid_records,
        selectedSpecies: [speciesOverride || file.species || extractSpeciesFromFilename(file.file_name) || "Untitled species"],
        cleanLoading: false,
        cleanError: null,
      }];
    });
  }, [setWorkspaceFiles]);

  const handleWorkspaceUpdate = useCallback((id: string, updates: Partial<WorkspaceFile>) => {
    setWorkspaceFiles((prev) => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, [setWorkspaceFiles]);

  const handleWorkspaceRemove = useCallback((id: string) => {
    setWorkspaceFiles((prev) => prev.filter(f => f.id !== id));
  }, [setWorkspaceFiles]);

  const handleWorkspaceReorder = useCallback((reordered: WorkspaceFile[]) => {
    setWorkspaceFiles(reordered);
  }, [setWorkspaceFiles]);

  const handleOpenInModel = useCallback((cardId: string) => {
    const card = workspaceFiles.find(f => f.id === cardId);
    if (!card) return;
    const store = useSDMStore.getState();
    store.setOccurrenceFilePath(card.filePath);
    store.setSpecies(card.selectedSpecies[0] || "Untitled species");
    store.setRecordCount(card.fileRows);
    if (card.cleanedFileId) {
      store.setCleanedOccurrence({
        filePath: card.cleanedFileId, df: [], sourceCounts: {},
        nAbsentExcluded: 0, originalRows: card.fileRows,
        validRecords: card.cleanValidRecords || card.fileRows,
      });
    }
    router.push("/model");
  }, [workspaceFiles, router]);

  // ── Climate state ───────────────────────────────────────────
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
  const [scenarios, setScenarios] = useState<ClimateScenarioResponse[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(false);

  const handleCancelDownload = useCallback(async () => {
    const active = climateDownloadJob || cmip6DownloadJob || avgDownloadJob;
    if (active) {
      try { await apiPost(`/api/v1/climate/cancel/${active}`); } catch { }
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
    try { const data = await apiGet<{ scenarios: ClimateScenarioResponse[] }>("/api/v1/climate/scenarios"); setScenarios(data.scenarios || []); }
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
    } catch { }
  };

  // ── Upload ──────────────────────────────────────────────────
  const fetchUploads = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiGet<{ uploads: Array<Record<string, unknown>> }>("/api/v1/data/occurrences/uploads");
      const mapped = (data.uploads || []).map((u) => ({
        id: u.id,
        file_id: u.file_path,
        file_name: u.filename,
        file_size: u.file_size,
        n_rows: u.n_rows,
        species: u.species,
        modified_at: u.created_at,
        cleaned: u.is_cleaned,
        cleaned_file_id: u.cleaned_file_path,
        cleaned_valid_records: u.cleaned_valid_records,
        format: u.format,
      }));
      setUploadHistory(mapped as UploadFile[]);
    } catch {
      setUploadHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { fetchUploads(); }, [fetchUploads]);

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
        const speciesName = detectedSpecies || extractSpeciesFromFilename(file.name) || null;
        if (speciesName) useSDMStore.getState().setSpecies(speciesName);
        const fakeFile: UploadFile = {
          file_id: fileId,
          file_name: file.name,
          file_size: file.size,
          n_rows: nRows,
          cleaned: false,
          modified_at: new Date().toISOString(),
          species: speciesName || undefined,
          format: file.name.endsWith(".zip") ? "dwca" : file.name.endsWith(".tsv") ? "tsv" : "csv",
        };
        handleWorkspaceAdd(fakeFile, speciesName || undefined);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
      fetchUploads();
    }
  };

  const handleDeleteUpload = async (fileId: string) => {
    try {
      await apiDelete(`/api/v1/data/uploads/${encodeURIComponent(fileId)}`);
      setWorkspaceFiles((prev) => prev.filter(f => f.fileId !== fileId));
      fetchUploads();
    } catch (err) {
      console.error("[data] Failed to delete upload:", err);
    }
  };

  // ── Legacy tab redirect ─────────────────────────────────────
  useEffect(() => {
    if (["gbif", "clean", "obs", "batch"].includes(activeTab)) {
      router.replace("/data?tab=upload");
    }
  }, [activeTab, router]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sdm-heading">Occurrence Data</h1>
        <p className="text-sdm-muted mt-1">Upload occurrence records, fetch from GBIF, or manage multiple occurrence files for model runs.</p>
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="flex w-full overflow-x-auto [&::-webkit-scrollbar]:hidden border-b border-sdm-border rounded-none bg-transparent p-0 gap-0">
          <TabsTrigger value="overview" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-none border-b-2 border-transparent px-4 py-2 text-sm hover:text-sdm-text mb-[-1px] data-[state=active]:border-sdm-accent data-[state=active]:text-sdm-text data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            <LayoutDashboard className="h-3 w-3" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-none border-b-2 border-transparent px-4 py-2 text-sm hover:text-sdm-text mb-[-1px] data-[state=active]:border-sdm-accent data-[state=active]:text-sdm-text data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            <Upload className="h-3 w-3" />
            Occurrence{workspaceFiles.length > 0 ? ` (${workspaceFiles.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="climate" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-none border-b-2 border-transparent px-4 py-2 text-sm hover:text-sdm-text mb-[-1px] data-[state=active]:border-sdm-accent data-[state=active]:text-sdm-text data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            <Cloud className="h-3 w-3" />
            Climate
          </TabsTrigger>
          <TabsTrigger value="covariates" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-none border-b-2 border-transparent px-4 py-2 text-sm hover:text-sdm-text mb-[-1px] data-[state=active]:border-sdm-accent data-[state=active]:text-sdm-text data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            <Layers className="h-3 w-3" />
            Covariates
          </TabsTrigger>
          <TabsTrigger value="boundary" className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-none border-b-2 border-transparent px-4 py-2 text-sm hover:text-sdm-text mb-[-1px] data-[state=active]:border-sdm-accent data-[state=active]:text-sdm-text data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            <Map className="h-3 w-3" />
            Boundary
          </TabsTrigger>
        </TabsList>

        {activeTab === "upload" && (
          <UploadTab
            uploadResult={uploadResult}
            uploadLoading={uploadLoading}
            uploadError={uploadError}
            onUpload={handleUpload}
            onDelete={handleDeleteUpload}
            previousUploads={uploadHistory}
            previousUploadsLoading={historyLoading}
            workspaceFiles={workspaceFiles}
            onWorkspaceAdd={handleWorkspaceAdd}
            onWorkspaceUpdate={handleWorkspaceUpdate}
            onWorkspaceRemove={handleWorkspaceRemove}
            onWorkspaceReorder={handleWorkspaceReorder}
            onOpenInModel={handleOpenInModel}
            onRefreshUploads={fetchUploads}
            hasGbifCredentials={hasGbifCredentials}
            hasAlaCredentials={hasAlaCredentials}
          />
        )}

        {activeTab === "overview" && (
          <OverviewTab
            uploadResult={uploadResult}
            cleanResult={cleanResult}
            species={species}
            recordCount={recordCount}
            hasGbifCredentials={hasGbifCredentials}
            hasAlaCredentials={hasAlaCredentials}
            climateSource={climateSource}
            climateRes={climateRes}
            onTabChange={onTabChange}
          />
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

        {activeTab === "covariates" && <CovariateTab />}
        {activeTab === "boundary" && <BoundaryTab />}
      </Tabs>
    </div>
  );
}
