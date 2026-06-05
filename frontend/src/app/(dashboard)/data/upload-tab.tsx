"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Upload, Globe, ChevronDown, ChevronRight, Loader2, AlertTriangle, CheckCircle2, HardDrive, Layers, Plus, Settings } from "lucide-react";
import { FileUpload } from "@/components/data/file-upload";
import { DetectedColumns } from "@/components/data/detected-columns";
import { PreviewTable } from "@/components/data/preview-table";
import { WorkspaceSourceCard } from "@/components/data/workspace-source-card";
import { WorkspaceCard } from "@/components/data/workspace-card";
import { ReviewRecordsModal } from "@/components/data/review-records-modal";
import { GbifSearch } from "@/components/data/gbif-search";
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
}

export function UploadTab({
  uploadResult, uploadLoading, uploadError, onUpload, onDelete,
  previousUploads, previousUploadsLoading,
  workspaceFiles, onWorkspaceAdd, onWorkspaceUpdate, onWorkspaceRemove,
  onOpenInModel, onWorkspaceReorder, onRefreshUploads, hasGbifCredentials,
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
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/search", {
        taxon, country, max_records: maxRecords, use_auth: useAuth,
      });
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
      const result = filePath
        ? await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/save", { file_path: filePath })
        : await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/gbif/save", {
            taxon: gbifResult.taxon, country: gbifResult.country, max_records: gbifResult.max_records,
          });
      const fakeFile: UploadFile = {
        file_id: result.file_path as string,
        file_name: `GBIF-${String(gbifResult.taxon || "search")}.csv`,
        file_size: 0,
        n_rows: Number(gbifResult.n_records || 0),
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
    if (!raw) return;
    try {
      const { file_id, in_workspace } = JSON.parse(raw) as { file_id: string; in_workspace?: boolean };
      if (in_workspace) return;
      const file = previousUploads.find(f => f.file_id === file_id);
      if (file && !workspaceFiles.some(w => w.fileId === file.file_id)) {
        onWorkspaceAdd(file);
      }
    } catch {}
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
            const cleanedFileId = (status.cleaned_file_id || status.cleaned_file_path || (status.result as Record<string, unknown> | undefined)?.cleaned_file_id) as string | undefined;
            if (!cleanedFileId) throw new Error("API returned no cleaned file ID");
            const validRecords = (status.valid_records as number) || ((status.result as Record<string, unknown> | undefined)?.valid_records as number) || 0;
            onWorkspaceUpdate(cardId, {
              cleanLoading: false,
              cleanedFileId,
              cleanValidRecords: validRecords,
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
    setReviewLoading(true);
    setReviewError(null);
    try {
      const result = await apiGet<Record<string, unknown>>(`/api/v1/data/occurrences/clean/result?file_id=${encodeURIComponent(card.fileId)}`);
      setReviewData({
        records: (result.cleaned_records || []) as OccurrencePoint[],
        sourceCounts: (result.source_counts || {}) as Record<string, number>,
        ccLog: (result.cc_log || []) as string[],
        validRecords: (result.valid_records as number) || 0,
        originalRows: (result.original_rows as number) || 0,
      });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Failed to load review data");
      setReviewData({
        records: [],
        sourceCounts: {},
        ccLog: [],
        validRecords: 0,
        originalRows: 0,
      });
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
            <Globe className="h-4 w-4 text-sdm-accent" />
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
                <WorkspaceSourceCard key={f.file_id} file={f}
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
