"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable, closestCenter,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Upload, Globe, ChevronDown, ChevronRight, Loader2, AlertTriangle, CheckCircle2, HardDrive, Search, Layers, Plus } from "lucide-react";
import { FileUpload } from "@/components/data/file-upload";
import { DetectedColumns } from "@/components/data/detected-columns";
import { PreviewTable } from "@/components/data/preview-table";
import { WorkspaceSourceCard } from "@/components/data/workspace-source-card";
import { WorkspaceCard } from "@/components/data/workspace-card";
import { ReviewRecordsModal } from "@/components/data/review-records-modal";
import { GbifSearch } from "@/components/data/gbif-search";
import { apiPost, apiGet } from "@/services/api";
import type { UploadFile } from "@/services/types";
import type { WorkspaceFile, OccurrencePoint } from "./types";

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
}

export function UploadTab({
  uploadResult, uploadLoading, uploadError, onUpload, onDelete,
  previousUploads, previousUploadsLoading,
  workspaceFiles, onWorkspaceAdd, onWorkspaceUpdate, onWorkspaceRemove, onOpenInModel,
}: UploadTabProps) {
  // ── Drag state ──────────────────────────────────────────────
  const [activeDragFile, setActiveDragFile] = useState<UploadFile | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (event.active.data.current?.type === "source") {
      setActiveDragFile(event.active.data.current.file as UploadFile);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragFile(null);
    const { active, over } = event;
    if (!over || over.id === active.id) return;
    // Source card dropped on workspace zone or any workspace card → add file
    if (active.data.current?.type === "source") {
      const file = active.data.current.file as UploadFile;
      const isWorkspaceTarget = over.id === "workspace-drop-zone" ||
        workspaceFiles.some(f => f.id === over.id);
      if (file && isWorkspaceTarget && !workspaceFiles.some(f => f.fileId === file.file_id)) {
        onWorkspaceAdd(file);
      }
      return;
    }
    // Reordering handled by SortableContext
  }, [workspaceFiles, onWorkspaceAdd]);

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

  // ── History panel open/close ────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Per-card cleaning ───────────────────────────────────────
  const cleanRunning = workspaceFiles.some(f => f.cleanLoading);

  const handleCleanCard = async (cardId: string) => {
    const card = workspaceFiles.find(f => f.id === cardId);
    if (!card || card.cleanLoading) return;
    onWorkspaceUpdate(cardId, { cleanLoading: true, cleanError: null });
    try {
      const result = await apiPost<Record<string, unknown>>("/api/v1/data/occurrences/clean", {
        file_id: card.fileId,
        species: card.selectedSpecies[0] || "",
        min_source_records: 15,
        merge_small_sources: true,
        use_cc: true,
        cc_tests: "all",
      }, { timeout: 600000 });
      const cleanedFileId = (result.cleaned_file_id || result.cleaned_file_path) as string | undefined;
      const validRecords = (result.valid_records as number) || 0;
      onWorkspaceUpdate(cardId, {
        cleanLoading: false,
        cleanedFileId,
        cleanValidRecords: validRecords,
      });
      if (cleanedFileId) {
        apiPost(`/api/v1/data/occurrences/clean/update-upload`, {
          file_id: card.fileId,
          cleaned: true,
          cleaned_file_path: cleanedFileId,
          cleaned_valid_records: validRecords,
        }).catch(() => {});
      }
    } catch (err) {
      onWorkspaceUpdate(cardId, {
        cleanLoading: false,
        cleanError: err instanceof Error ? err.message : "Clean failed",
      });
    }
  };

  const handleCleanAll = async () => {
    const toClean = workspaceFiles.filter(f => f.cleanBeforeRun && !f.cleanedFileId && !f.cleanLoading);
    await Promise.allSettled(toClean.map(f => handleCleanCard(f.id)));
  };

  // ── Review records modal ────────────────────────────────────
  const [reviewCardId, setReviewCardId] = useState<string | null>(null);
  const reviewCard = reviewCardId ? workspaceFiles.find(f => f.id === reviewCardId) : null;
  const [reviewData, setReviewData] = useState<{
    records: OccurrencePoint[]; sourceCounts: Record<string, number>; ccLog: string[];
    validRecords: number; originalRows: number;
  } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const handleReviewRecords = async (cardId: string) => {
    const card = workspaceFiles.find(f => f.id === cardId);
    if (!card) return;
    setReviewCardId(cardId);
    setReviewLoading(true);
    try {
      const result = await apiGet<Record<string, unknown>>(`/api/v1/data/occurrences/clean/result?file_id=${encodeURIComponent(card.fileId)}`).catch(() => null);
      if (result) {
        setReviewData({
          records: (result.cleaned_records || []) as OccurrencePoint[],
          sourceCounts: (result.source_counts || {}) as Record<string, number>,
          ccLog: (result.cc_log || []) as string[],
          validRecords: (result.valid_records as number) || 0,
          originalRows: (result.original_rows as number) || 0,
        });
      } else {
        setReviewData({
          records: [],
          sourceCounts: {},
          ccLog: [],
          validRecords: 0,
          originalRows: 0,
        });
      }
    } catch {
      setReviewData(null);
    } finally {
      setReviewLoading(false);
    }
  };

  // ── Workspace drop zone ─────────────────────────────────────
  const { setNodeRef: dropZoneRef, isOver } = useDroppable({ id: "workspace-drop-zone" });

  // ── Derived ─────────────────────────────────────────────────
  const uploadPreview = uploadResult?.preview as Array<Record<string, unknown>> | undefined;
  const cols = uploadResult?.columns_detected as Record<string, string | null> | undefined;
  const warningsRaw = uploadResult?.coord_warnings;
  const warnings = Array.isArray(warningsRaw) ? warningsRaw : (warningsRaw ? [String(warningsRaw)] : []);
  const hasWarnings = warnings.length > 0;
  const hasResult = typeof uploadResult?.file_path === "string";

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

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
              <GbifSearch onSearch={handleGbifSearch} loading={gbifLoading} error={gbifError} result={gbifResult} />
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
        <div ref={dropZoneRef}
          className={`rounded-lg border p-6 transition-colors ${
            isOver && activeDragFile
              ? "border-sdm-accent bg-sdm-accent/5"
              : "border-sdm-border bg-sdm-surface"
          }`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-sdm-heading">Workspace</h2>
              <p className="text-sm text-sdm-muted">{workspaceFiles.length} file{workspaceFiles.length !== 1 ? "s" : ""} selected</p>
            </div>
            {workspaceFiles.length > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={handleCleanAll} disabled={cleanRunning || workspaceFiles.filter(f => f.cleanBeforeRun && !f.cleanedFileId).length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-50">
                  {cleanRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Clean all
                </button>
              </div>
            )}
          </div>

          {workspaceFiles.length === 0 ? (
            <div className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center transition-colors ${
              isOver && activeDragFile
                ? "border-sdm-accent bg-sdm-accent/5"
                : "border-sdm-border bg-sdm-surface-soft"
            }`}>
              <Layers className="h-8 w-8 text-sdm-muted mb-2" />
              <p className="text-sm text-sdm-muted">
                {isOver && activeDragFile ? "Drop to add file" : "Drag files from the history below, or upload a new file above"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <SortableContext items={workspaceFiles.map(f => f.id)} strategy={verticalListSortingStrategy}>
                {workspaceFiles.map((f, i) => (
                  <WorkspaceCard key={f.id} item={f} index={i}
                    onUpdate={onWorkspaceUpdate} onRemove={onWorkspaceRemove}
                    onClean={handleCleanCard} onReviewRecords={handleReviewRecords}
                    onOpenInModel={onOpenInModel}
                    disabled={false} />
                ))}
              </SortableContext>
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
          <div className="px-6 pb-4 space-y-2 max-h-80 overflow-y-auto">
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
                    onAddToWorkspace={() => onWorkspaceAdd(f)} />
                ))}
              </div>
            )}
          </div>
        </details>

        {/* ── Drag overlay ──────────────────────────────────── */}
        <DragOverlay>
          {activeDragFile ? (
            <div className="flex items-center gap-2 rounded-md border border-sdm-accent bg-sdm-surface px-3 py-2.5 shadow-xl opacity-80">
              <Upload className="h-4 w-4 text-sdm-accent" />
              <span className="text-sm font-medium text-sdm-text">{activeDragFile.file_name}</span>
              <span className="text-xs text-sdm-muted">{activeDragFile.n_rows.toLocaleString()} rows</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ── Review records modal ───────────────────────────── */}
      {reviewLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Loader2 className="h-8 w-8 animate-spin text-sdm-accent" />
        </div>
      )}
      {reviewData && reviewCardId && (
        <ReviewRecordsModal
          open={true}
          onClose={() => { setReviewCardId(null); setReviewData(null); }}
          records={reviewData.records}
          sourceCounts={reviewData.sourceCounts}
          ccLog={reviewData.ccLog}
          validRecords={reviewData.validRecords}
          originalRows={reviewData.originalRows}
        />
      )}
    </div>
  );
}
