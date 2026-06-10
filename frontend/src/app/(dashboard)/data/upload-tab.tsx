"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Upload, ChevronDown, ChevronRight, Loader2, AlertTriangle, CheckCircle2, HardDrive, Layers, Plus, Settings } from "lucide-react";
import { GbifMark, AlaMark } from "@/components/data/source-icons";
import { FileUpload } from "@/components/data/file-upload";
import { DetectedColumns } from "@/components/data/detected-columns";
import { PreviewTable } from "@/components/data/preview-table";
import { WorkspaceSourceCard } from "@/components/data/workspace-source-card";
import { WorkspaceCard } from "@/components/data/workspace-card";
import { ReviewRecordsModal } from "@/components/data/review-records-modal";
import { GbifSearch } from "@/components/data/gbif-search";
import { AlaSearch } from "@/components/data/ala-search";
import { SyntheticExamplesPanel } from "@/components/data/synthetic-examples-panel";
import { apiPost, apiGet, apiPatch } from "@/services/api";
import type { UploadFile } from "@/services/types";
import type { WorkspaceFile, OccurrencePoint } from "./types";

const CC_TESTS_OPTIONS = [
  { value: "sea", label: "Sea" },
  { value: "capitals", label: "Capitals" },
  { value: "centroids", label: "Centroids" },
  { value: "institutions", label: "Institutions" },
  { value: "urban", label: "Urban" },
  { value: "zero", label: "Zero coordinates" },
  { value: "equal", label: "Equal coordinates" },
  { value: "gbif", label: "GBIF headquarters" },
  { value: "country", label: "Country" },
];

interface UploadTabProps {
  uploadResult: Record<string, unknown> | null;
  uploadLoading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onDelete: (fileId: string) => void;
  previousUploads: UploadFile[];
  previousUploadsLoading: boolean;
  workspaceFiles: WorkspaceFile[];
  onWorkspaceAdd: (file: UploadFile, species?: string) => void;
  onWorkspaceUpdate: (id: string, updates: Partial<WorkspaceFile>) => void;
  onWorkspaceRemove: (id: string) => void;
  onOpenInModel: (id: string) => void;
  onWorkspaceReorder: (files: WorkspaceFile[]) => void;
  onRefreshUploads?: () => void;
  hasGbifCredentials?: boolean;
  hasAlaCredentials?: boolean;
}

export function UploadTab({
  uploadResult, uploadLoading, uploadError, onUpload, onDelete,
  previousUploads, previousUploadsLoading,
  workspaceFiles, onWorkspaceAdd, onWorkspaceUpdate, onWorkspaceRemove,
  onOpenInModel, onWorkspaceReorder, onRefreshUploads, hasGbifCredentials, hasAlaCredentials,
}: UploadTabProps) {
  // ── Storage ─────────────────────────────────────────────────
  const [storage, setStorage] = useState<{ used_mb: number; quota_mb: number; pct_used: number } | null>(null);
  useEffect(() => {
    apiGet<{ used_mb: number; quota_mb: number; pct_used: number }>("/api/v1/data/storage")
      .then((d) => setStorage(d)).catch(() => {});
  }, [uploadResult]);

  // ── GBIF inline ─────────────────────────────────────────────
  const [gbifOpen, setGbifOpen] = useState(false);
  const [gbifLoading, setGbifLoading] = useState(false);
  const [gbifError, setGbifError] = useState<string | null>(null);
  const [gbifResult, setGbifResult] = useState<Record<string, unknown> | null>(null);
  const [gbifSaving, setGbifSaving] = useState(false);

  const handleGbifSearch = async (taxon: string, country: string, maxRecords: number, useAuth: boolean) => {
    setGbifLoading(true); setGbifError(null); setGbifResult(null);
    try {
      const initial = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/search", {
        taxon, country, max_records: maxRecords, use_auth: useAuth,
      });
      const jobId = initial?.job_id as string | undefined;
      const result = jobId ? await pollDataJob(jobId) : initial;
      setGbifResult(result);
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "GBIF search failed");
    } finally {
      setGbifLoading(false);
    }
  };

  const handleGbifAddToWorkspace = async () => {
    if (!gbifResult) return;
    setGbifSaving(true);
    try {
      const filePath = gbifResult.file_path as string | undefined;
      const nRecords = Number(gbifResult.n_records || 0);
      const result = filePath
        ? await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/save", { file_path: filePath, n_rows: nRecords })
        : await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/save", {
            taxon: gbifResult.taxon, country: gbifResult.country, max_records: gbifResult.max_records,
          });
      const fakeFile: UploadFile = {
        file_id: result.file_path as string,
        file_name: `GBIF-${String(gbifResult.taxon || "search")}.csv`,
        file_size: 0,
        n_rows: nRecords,
        cleaned: false,
        modified_at: new Date().toISOString(),
        species: String(gbifResult.taxon || ""),
        format: "csv",
      };
      onWorkspaceAdd(fakeFile, String(gbifResult.taxon || ""));
      setGbifResult(null);
    } catch (err) {
      setGbifError(err instanceof Error ? err.message : "Failed to save GBIF records");
    } finally {
      setGbifSaving(false);
    }
  };

  // ── Async job polling ─────────────────────────────────────────
  const pollDataJob = useCallback(async (jobId: string): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const status = await apiGet<Record<string, unknown>>(`/api/v1/data/occurrences/job/${jobId}`);
      if (status.status === "completed") {
        if (status.result && typeof status.result === "object") return status.result as Record<string, unknown>;
        throw new Error("Job completed but no result data");
      }
      if (status.status === "failed" || status.status === "error") {
        throw new Error((status.error as string) || "Job failed");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Search timed out. Please try again.");
  }, []);

  // ── ALA inline ──────────────────────────────────────────────
  const [alaOpen, setAlaOpen] = useState(false);
  const [alaLoading, setAlaLoading] = useState(false);
  const [alaError, setAlaError] = useState<string | null>(null);
  const [alaResult, setAlaResult] = useState<Record<string, unknown> | null>(null);
  const [alaSaving, setAlaSaving] = useState(false);

  const handleAlaSearch = async (taxon: string, country: string, maxRecords: number, apiKey: string) => {
    setAlaLoading(true); setAlaError(null); setAlaResult(null);
    try {
      const initial = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/ala/search", {
        taxon, country, max_records: maxRecords, api_key: apiKey || undefined,
      });
      const jobId = initial?.job_id as string | undefined;
      const result = jobId ? await pollDataJob(jobId) : initial;
      setAlaResult(result);
    } catch (err) {
      setAlaError(err instanceof Error ? err.message : "ALA search failed");
    } finally {
      setAlaLoading(false);
    }
  };

  const handleAlaAddToWorkspace = async () => {
    if (!alaResult) return;
    setAlaSaving(true);
    try {
      const filePath = alaResult.file_path as string | undefined;
      const nRecords = Number(alaResult.n_records || 0);
      const result = filePath
        ? await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/ala/save", { file_path: filePath, n_rows: nRecords })
        : await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/ala/save", {
            taxon: alaResult.taxon, country: alaResult.country, max_records: alaResult.max_records,
          });
      const fakeFile: UploadFile = {
        file_id: result.file_path as string,
        file_name: `ALA-${String(alaResult.taxon || "search")}.csv`,
        file_size: 0,
        n_rows: nRecords,
        cleaned: false,
        modified_at: new Date().toISOString(),
        species: String(alaResult.taxon || ""),
        format: "csv",
      };
      onWorkspaceAdd(fakeFile, String(alaResult.taxon || ""));
      setAlaResult(null);
    } catch (err) {
      setAlaError(err instanceof Error ? err.message : "Failed to save ALA records");
    } finally {
      setAlaSaving(false);
    }
  };

  // ── Native drag-and-drop ────────────────────────────────────
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData("application/x-sdm-file");
    const rawExample = e.dataTransfer.getData("application/x-sdm-example");
    if (raw) {
      try {
        const { file_id, in_workspace } = JSON.parse(raw) as { file_id: string; in_workspace?: boolean };
        if (in_workspace) return;
        const file = previousUploads.find(f => f.file_id === file_id);
        if (file && !workspaceFiles.some(w => w.fileId === file.file_id)) {
          onWorkspaceAdd(file);
        }
      } catch {}
    } else if (rawExample) {
      e.preventDefault();
      const name = rawExample;
      apiPost<Record<string, unknown>>("/api/v1/data/examples/load", { name }).then((result) => {
        if (!result) return;
        const fileId = (result.file_id as string) || (result.file_path as string) || "";
        const nRows = typeof result.n_rows === "number" ? result.n_rows : 0;
        const speciesDetected = (result.species_detected as string) || null;
        const file: UploadFile = {
          file_id: fileId,
          file_name: `${name}.csv`,
          file_size: 0,
          n_rows: nRows,
          cleaned: false,
          modified_at: new Date().toISOString(),
          species: speciesDetected || undefined,
          format: "csv",
        };
        onWorkspaceAdd(file, speciesDetected || undefined);
      }).catch(() => {});
    }
  }, [previousUploads, workspaceFiles, onWorkspaceAdd]);

  // ── Sources panel drop zone (remove from workspace on drag-back) ─
  const [sourcesDragOver, setSourcesDragOver] = useState(false);

  const handleSourcesDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleSourcesDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setSourcesDragOver(true);
  }, []);

  const handleSourcesDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setSourcesDragOver(false);
  }, []);

  const handleSourcesDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setSourcesDragOver(false);
    const raw = e.dataTransfer.getData("application/x-sdm-file");
    if (!raw) return;
    try {
      const { file_id, in_workspace } = JSON.parse(raw) as { file_id: string; in_workspace?: boolean };
      if (!in_workspace) return;
      const wsFile = workspaceFiles.find(w => w.fileId === file_id);
      if (wsFile) onWorkspaceRemove(wsFile.id);
    } catch {}
  }, [workspaceFiles, onWorkspaceRemove]);

  // ── Cleaning defaults ────────────────────────────────────────
  const [cleaningDefaults, setCleaningDefaults] = useState({
    use_cc: true,
    cc_tests: "all",
    min_source_records: 15,
    merge_small_sources: true,
  });

  const isCcTestSelected = (test: string) =>
    cleaningDefaults.cc_tests === "all" || cleaningDefaults.cc_tests.split(",").includes(test);

  const handleToggleCcTest = (test: string) => {
    setCleaningDefaults(prev => {
      const current = prev.cc_tests === "all"
        ? CC_TESTS_OPTIONS.map(o => o.value)
        : prev.cc_tests.split(",").filter(Boolean);
      const next = current.includes(test)
        ? current.filter(t => t !== test)
        : [...current, test];
      return { ...prev, cc_tests: next.length === CC_TESTS_OPTIONS.length ? "all" : next.join(",") };
    });
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // ── History panel open/close ────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Per-card cleaning ───────────────────────────────────────
  const cleanRunning = workspaceFiles.some(f => f.cleanLoading);
  const cleanAllCount = workspaceFiles.filter(f => !f.cleanedFileId && !f.cleanLoading).length;
  const cleanActiveCount = workspaceFiles.filter(f => f.cleanLoading).length;

  const handleCleanCard = async (cardId: string) => {
    const card = workspaceFiles.find(f => f.id === cardId);
    if (!card || card.cleanLoading) return;
    onWorkspaceUpdate(cardId, { cleanLoading: true, cleanError: null });
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/clean", {
        file_id: card.fileId,
        species: card.selectedSpecies[0] || "",
        min_source_records: cleaningDefaults.min_source_records,
        merge_small_sources: cleaningDefaults.merge_small_sources,
        use_cc: cleaningDefaults.use_cc,
        cc_tests: cleaningDefaults.cc_tests,
        async: true,
      }, { timeout: 15000 });
      const jobId = (result.job_id || result.jobId) as string | undefined;
      if (!jobId) throw new Error("No job ID returned from clean request");

      // Poll for job completion
      const deadline = Date.now() + 600000;
      let lastError: string | null = null;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const status = await apiGet<Record<string, unknown>>(`/api/v1/data/jobs/${encodeURIComponent(jobId)}`);
          const s = status?.status as string | undefined;
          if (s === "completed" || s === "success") {
            const resultData = (status.result as Record<string, unknown> | undefined) || status;
            const cleanedFileId = (resultData.cleaned_file_id || resultData.cleaned_file_path) as string | undefined;
            if (!cleanedFileId) throw new Error("API returned no cleaned file ID");
            const validRecords = (resultData.valid_records as number) || 0;
            const originalRows = (resultData.original_rows as number) || 0;
            const sourceCounts = (resultData.source_counts as Record<string, number>) || undefined;
            const ccLog = (resultData.cc_log as string[]) || undefined;
            const records = (resultData.cleaned_records as OccurrencePoint[]) || undefined;
            onWorkspaceUpdate(cardId, {
              cleanLoading: false,
              cleanedFileId,
              cleanValidRecords: validRecords,
              cleanOriginalRows: originalRows,
              cleanSourceCounts: sourceCounts,
              cleanCcLog: ccLog,
              cleanRecords: records,
            });
            apiPatch(`/api/v1/data/uploads/${encodeURIComponent(card.fileId)}`, {
              cleaned: true,
              cleaned_file_path: cleanedFileId,
              cleaned_valid_records: validRecords,
            }).catch(() => {});
            onRefreshUploads?.();
            return;
          }
          if (s === "failed" || s === "error") {
            throw new Error((status.error as string) || "Clean job failed");
          }
        } catch (err) {
          if (err instanceof Error && err.message !== "Clean job failed") {
            lastError = err.message;
          } else {
            throw err;
          }
        }
      }
      throw new Error(lastError || "Clean job timed out");
    } catch (err) {
      onWorkspaceUpdate(cardId, {
        cleanLoading: false,
        cleanError: err instanceof Error ? err.message : "Clean failed",
      });
    }
  };

  const handleCleanAll = async () => {
    const toClean = workspaceFiles.filter(f => !f.cleanedFileId && !f.cleanLoading);
    for (let i = 0; i < toClean.length; i += 3) {
      await Promise.allSettled(toClean.slice(i, i + 3).map(f => handleCleanCard(f.id)));
    }
  };

  // ── Review records modal ────────────────────────────────────
  const [reviewCardId, setReviewCardId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<{
    records: OccurrencePoint[]; sourceCounts: Record<string, number>; ccLog: string[];
    validRecords: number; originalRows: number;
  } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const handleReviewRecords = async (cardId: string) => {
    const card = workspaceFiles.find(f => f.id === cardId);
    if (!card) return;
    setReviewCardId(cardId);
    setReviewError(null);

    // Use locally stored data if available (from job poll result)
    if (card.cleanRecords && card.cleanSourceCounts) {
      setReviewData({
        records: card.cleanRecords,
        sourceCounts: card.cleanSourceCounts,
        ccLog: card.cleanCcLog || [],
        validRecords: card.cleanValidRecords || 0,
        originalRows: card.cleanOriginalRows || 0,
      });
      return;
    }

    setReviewLoading(true);
    try {
      const params = new URLSearchParams({ file_id: card.fileId });
      if (card.cleanedFileId) params.set("cleaned_file_id", card.cleanedFileId);
      const result = await apiGet<Record<string, unknown>>(`/api/v1/data/occurrences/clean/result?${params}`);
      const apiRecords = (result.cleaned_records || []) as OccurrencePoint[];
      const apiSourceCounts = (result.source_counts || {}) as Record<string, number>;
      const apiCcLog = (result.cc_log || []) as string[];
      const apiValidRecords = (result.valid_records as number) || 0;

      // If API returned empty but card is known cleaned, use card summary counts
      if (apiValidRecords === 0 && card.cleanedFileId && card.cleanValidRecords) {
        setReviewData({
          records: apiRecords,
          sourceCounts: apiSourceCounts,
          ccLog: apiCcLog,
          validRecords: card.cleanValidRecords,
          originalRows: card.cleanOriginalRows || card.fileRows,
        });
      } else {
        setReviewData({
          records: apiRecords,
          sourceCounts: apiSourceCounts,
          ccLog: apiCcLog,
          validRecords: apiValidRecords,
          originalRows: (result.original_rows as number) || card.fileRows,
        });
      }
    } catch (err) {
      // If file was cleaned, show summary counts even if detailed data unavailable
      if (card.cleanedFileId) {
        setReviewData({
          records: [],
          sourceCounts: {},
          ccLog: [],
          validRecords: card.cleanValidRecords || card.fileRows,
          originalRows: card.fileRows,
        });
      } else {
        setReviewError(err instanceof Error ? err.message : "Failed to load review data");
        setReviewData({ records: [], sourceCounts: {}, ccLog: [], validRecords: 0, originalRows: 0 });
      }
    } finally {
      setReviewLoading(false);
    }
  };

  // ── Workspace sorting ───────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } })
  );

  const handleSortEnd = useCallback((event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = workspaceFiles.findIndex(f => f.id === active.id);
    const newIndex = workspaceFiles.findIndex(f => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...workspaceFiles];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    onWorkspaceReorder(reordered);
  }, [workspaceFiles, onWorkspaceReorder]);

  // ── Derived ─────────────────────────────────────────────────
  const uploadPreview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const cols = uploadResult?.columns_detected as Record<string, string | null> | undefined;
  const warningsRaw = uploadResult?.coord_warnings;
  const warnings = Array.isArray(warningsRaw) ? warningsRaw : (warningsRaw ? [String(warningsRaw)] : []);
  const hasWarnings = warnings.length > 0;

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Add data section ──────────────────────────────── */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h2 className="text-lg font-semibold text-sdm-heading mb-4">Add occurrence data</h2>

        <FileUpload key={String(uploadResult?.file_id ?? "new")} onUpload={onUpload} loading={uploadLoading} error={uploadError} />

        {storage && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft px-4 py-2.5">
            <HardDrive className="h-4 w-4 shrink-0 text-sdm-muted" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs text-sdm-muted mb-1">
                <span>Storage: {storage.used_mb} MB used</span>
                <span>{storage.pct_used}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-sdm-border overflow-hidden">
                <div className={`h-full rounded-full transition-all ${storage.pct_used > 90 ? "bg-sdm-danger" : "bg-sdm-accent"}`}
                  style={{ width: `${Math.min(storage.pct_used, 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {cols && Object.keys(cols).length > 0 && <div className="mt-3"><DetectedColumns columns={cols} /></div>}
        {hasWarnings && (
          <div className="mt-3 rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 text-sm text-sdm-warning">
            <AlertTriangle className="h-4 w-4 inline mr-1.5 -mt-0.5" />
            {warnings.join("; ")}
          </div>
        )}
        {uploadPreview && uploadPreview.length > 0 && <div className="mt-3"><PreviewTable data={uploadPreview} title="Preview (first 5 records)" /></div>}

        {/* GBIF inline */}
        <details className="mt-4" open={gbifOpen} onToggle={(e) => setGbifOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-sdm-heading">
            <GbifMark className="h-4 w-4" />
            Search GBIF
          </summary>
          <div className="mt-3">
            <GbifSearch onSearch={handleGbifSearch} loading={gbifLoading} error={gbifError} result={gbifResult} hasSavedCredentials={hasGbifCredentials} />
            {gbifResult && Number(gbifResult.n_records) > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <button onClick={handleGbifAddToWorkspace} disabled={gbifSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50">
                  {gbifSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add {Number(gbifResult.n_records).toLocaleString()} records to workspace
                </button>
              </div>
            )}
          </div>
        </details>

        {/* ALA inline */}
        <details className="mt-4" open={alaOpen} onToggle={(e) => setAlaOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-sdm-heading">
            <AlaMark className="h-4 w-4" />
            Search ALA
          </summary>
          <div className="mt-3">
            <AlaSearch onSearch={handleAlaSearch} loading={alaLoading} error={alaError} result={alaResult} hasApiKey={hasAlaCredentials} />
            {alaResult && Number(alaResult.n_records) > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <button onClick={handleAlaAddToWorkspace} disabled={alaSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50">
                  {alaSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add {Number(alaResult.n_records).toLocaleString()} records to workspace
                </button>
              </div>
            )}
          </div>
        </details>

        <SyntheticExamplesPanel onAddToWorkspace={onWorkspaceAdd} />
      </div>

      {/* ── Workspace ──────────────────────────────────────── */}
      <div
        onDragOver={handleDragOver} onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`rounded-lg border p-6 transition-colors ${
          isDragOver ? "border-sdm-accent bg-sdm-accent/5" : "border-sdm-border bg-sdm-surface"
        }`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-sdm-heading">Workspace</h2>
            <p className="text-sm text-sdm-muted">{workspaceFiles.length} file{workspaceFiles.length !== 1 ? "s" : ""} selected</p>
          </div>
          {workspaceFiles.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative" ref={settingsRef}>
                <button onClick={() => setSettingsOpen(!settingsOpen)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-2.5 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface">
                  <Settings className="h-3.5 w-3.5" />
                </button>
                {settingsOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-sdm-border bg-sdm-bg shadow-xl p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-sdm-heading">Clean settings</h3>
                    <label className="flex items-center gap-2 text-xs text-sdm-text cursor-pointer">
                      <input type="checkbox" checked={cleaningDefaults.use_cc}
                        onChange={(e) => setCleaningDefaults(p => ({ ...p, use_cc: e.target.checked }))}
                        className="rounded border-sdm-border" />
                      Use CoordinateCleaner
                    </label>
                    {cleaningDefaults.use_cc && (
                      <div className="space-y-1 pl-4">
                        <p className="text-xs text-sdm-muted">CC tests</p>
                        {CC_TESTS_OPTIONS.map(opt => (
                          <label key={opt.value} className="flex items-center gap-1.5 text-xs text-sdm-text cursor-pointer">
                            <input type="checkbox" checked={isCcTestSelected(opt.value)}
                              onChange={() => handleToggleCcTest(opt.value)}
                              className="rounded border-sdm-border" />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-sdm-muted">Min records per source</label>
                      <input type="number" value={cleaningDefaults.min_source_records}
                        onChange={(e) => setCleaningDefaults(p => ({ ...p, min_source_records: Math.max(1, parseInt(e.target.value) || 1) }))}
                        min={1} className="w-full rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text" />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-sdm-text cursor-pointer">
                      <input type="checkbox" checked={cleaningDefaults.merge_small_sources}
                        onChange={(e) => setCleaningDefaults(p => ({ ...p, merge_small_sources: e.target.checked }))}
                        className="rounded border-sdm-border" />
                      Merge small sources
                    </label>
                  </div>
                )}
              </div>
              <button onClick={handleCleanAll} disabled={cleanRunning || cleanAllCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-50">
                {cleanRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {cleanRunning ? `Cleaning (${cleanActiveCount} active)` : "Clean all"}
              </button>
            </div>
          )}
        </div>

        {workspaceFiles.length === 0 ? (
          <div className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center transition-colors ${
            isDragOver ? "border-sdm-accent bg-sdm-accent/5" : "border-sdm-border bg-sdm-surface-soft"
          }`}>
            <Layers className="h-8 w-8 text-sdm-muted mb-2" />
            <p className="text-sm text-sdm-muted">
              {isDragOver ? "Drop to add file" : 'Click "Add" on a source file below, or upload a new file above'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSortEnd}>
              <SortableContext items={workspaceFiles.map(f => f.id)} strategy={verticalListSortingStrategy}>
                {workspaceFiles.map((f, i) => (
                  <WorkspaceCard key={f.id} item={f} index={i}
                    onUpdate={onWorkspaceUpdate} onRemove={onWorkspaceRemove}
                    onClean={handleCleanCard} onReviewRecords={handleReviewRecords}
                    onOpenInModel={onOpenInModel}
                    disabled={cleanRunning} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {/* ── Sources (history) ─────────────────────────────── */}
      <details className="rounded-lg border border-sdm-border bg-sdm-surface" open={historyOpen}
        onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer items-center gap-2 px-6 py-3 text-sm font-medium text-sdm-heading">
          {historyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Sources ({previousUploads.length} files)
        </summary>
        <div
          onDragOver={handleSourcesDragOver} onDragEnter={handleSourcesDragEnter}
          onDragLeave={handleSourcesDragLeave} onDrop={handleSourcesDrop}
          className={`px-6 pb-4 space-y-2 max-h-80 overflow-y-auto transition-colors ${
            sourcesDragOver ? "ring-2 ring-sdm-danger/50 bg-sdm-danger/5" : ""
          }`}>
          {previousUploadsLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-sdm-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : previousUploads.length === 0 ? (
            <p className="py-4 text-sm text-sdm-muted">No previous uploads found.</p>
          ) : (
            <div className="space-y-1.5">
              {previousUploads.map((f) => (
                <WorkspaceSourceCard key={f.id || f.file_id} file={f}
                  disabled={workspaceFiles.some(w => w.fileId === f.file_id)}
                  onAddToWorkspace={() => onWorkspaceAdd(f)}
                  onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
      </details>

      {/* ── Review records modal ───────────────────────────── */}
      {reviewLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Loader2 className="h-8 w-8 animate-spin text-sdm-accent" />
        </div>
      )}
      {reviewData && reviewCardId && !reviewError && (
        <ReviewRecordsModal
          open={true}
          onClose={() => { setReviewCardId(null); setReviewData(null); setReviewError(null); }}
          records={reviewData.records}
          sourceCounts={reviewData.sourceCounts}
          ccLog={reviewData.ccLog}
          validRecords={reviewData.validRecords}
          originalRows={reviewData.originalRows}
        />
      )}
      {reviewError && reviewCardId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-lg border border-sdm-danger/30 bg-sdm-surface p-6 max-w-md shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-sdm-danger" />
              <h3 className="text-sm font-semibold text-sdm-heading">Failed to load review</h3>
            </div>
            <p className="text-sm text-sdm-muted">{reviewError}</p>
            <button onClick={() => { setReviewCardId(null); setReviewData(null); setReviewError(null); }}
              className="mt-4 rounded-md bg-sdm-surface-soft px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-border">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
