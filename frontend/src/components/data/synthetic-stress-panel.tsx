"use client";

import { useState, useCallback } from "react";
import { apiPost } from "@/services/api";
import { Loader2, Beaker, CheckCircle2, AlertTriangle, Layers, Cpu } from "lucide-react";
import type { UploadFile } from "@/services/types";

interface SyntheticStressPanelProps {
  onAddToWorkspace: (file: UploadFile, species?: string) => void;
  onSavedExample?: () => void;
}

interface GenerationResult {
  file_id: string;
  file_path: string;
  file_name: string;
  n_species: number;
  n_records: number;
  n_errors: number;
  error_rate: number;
  species_names: string[];
  sigmas: number[];
  level: string;
  target_architecture: string;
  raster_cells: number;
  message: string;
}

type StressLevel = "small" | "medium" | "large" | "custom";

const PRESETS: Record<string, { species: number; occ: number; arch: string; desc: string }> = {
  small:  { species: 3,  occ: 2000,  arch: "DNN_Small",  desc: "3 species × 2,000 occ — smoke test for DNN_Small" },
  medium: { species: 6,  occ: 10000, arch: "DNN_Medium", desc: "6 species × 10,000 occ — realistic multi-species" },
  large:  { species: 20, occ: 50000, arch: "DNN_Large",  desc: "20 species × 50,000 occ — full stress test" },
};

export function SyntheticStressPanel({ onAddToWorkspace, onSavedExample }: SyntheticStressPanelProps) {
  const [level, setLevel] = useState<StressLevel>("medium");
  const [customSpecies, setCustomSpecies] = useState(5);
  const [customOcc, setCustomOcc] = useState(5000);
  const [errorRate, setErrorRate] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [savingExample, setSavingExample] = useState(false);
  const [savedExampleName, setSavedExampleName] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setResultError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = { level, seed: 42, error_rate: errorRate / 100 };
      if (level === "custom") {
        body.n_species = customSpecies;
        body.n_occ = customOcc;
      }
      const data = await apiPost<GenerationResult>("/api/v1/data/occurrences/synthetic", body);
      setResult(data);

      const file: UploadFile = {
        file_id: data.file_id,
        file_name: data.file_name,
        file_size: 0,
        n_rows: data.n_records,
        cleaned: false,
        modified_at: new Date().toISOString(),
        species: Array.isArray(data.species_names) ? data.species_names.join(", ") : undefined,
        format: "csv",
      };
      const speciesList = Array.isArray(data.species_names) ? data.species_names.join(", ") : undefined;
      onAddToWorkspace(file, speciesList);
      setSavedExampleName(null);
    } catch (err) {
      setResultError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, [level, customSpecies, customOcc, errorRate, onAddToWorkspace]);

  const handleSaveExample = useCallback(async () => {
    if (!result) return;
    setSavingExample(true);
    setSavedExampleName(null);
    try {
      const res = await apiPost<{ name: string }>("/api/v1/data/examples/save", {
        file_id: result.file_id,
        metadata: {
          n_species: result.n_species,
          n_records: result.n_records,
          n_errors: result.n_errors,
          species_names: result.species_names,
          description: result.message,
          level: result.level,
        },
      });
      setSavedExampleName(res.name);
      onSavedExample?.();
    } catch (err) {
      setResultError(err instanceof Error ? err.message : "Failed to save example");
    } finally {
      setSavingExample(false);
    }
  }, [result, onSavedExample]);

  const preset = level !== "custom" ? PRESETS[level] : null;
  const totalRecords = preset ? preset.species * preset.occ : customSpecies * customOcc;

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Beaker className="h-4 w-4 text-sdm-accent" />
        <span className="text-sm font-semibold text-sdm-heading">Synthetic multi-species stress data</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["small", "medium", "large", "custom"] as StressLevel[]).map((l) => (
          <button
            key={l}
            onClick={() => { setLevel(l); setResult(null); setResultError(null); }}
            className={`text-xs rounded px-3 py-1.5 border transition-colors ${
              level === l
                ? "bg-sdm-accent/15 text-sdm-accent border-sdm-accent/30"
                : "bg-sdm-surface text-sdm-muted border-sdm-border hover:text-sdm-text"
            }`}
          >
            {l === "small" ? "DNN_Small" : l === "medium" ? "DNN_Medium" : l === "large" ? "DNN_Large" : "Custom"}
          </button>
        ))}
      </div>

      {level !== "custom" && preset && (
        <div className="rounded-md bg-sdm-accent/5 border border-sdm-accent/10 p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-sdm-text">
            <Cpu className="h-3.5 w-3.5" />
            {preset.arch}
          </div>
          <p className="text-xs text-sdm-muted">{preset.desc}</p>
          <div className="flex items-center gap-3 text-xs text-sdm-muted mt-1">
            <span>{preset.species} species</span>
            <span>{preset.occ.toLocaleString()} occ/species</span>
            <span>{totalRecords.toLocaleString()} total records</span>
          </div>
        </div>
      )}

      {level === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">Species (2-50)</label>
            <input
              type="number"
              min={2}
              max={50}
              value={customSpecies}
              onChange={(e) => setCustomSpecies(Math.max(2, Math.min(50, Number(e.target.value))))}
              className="w-full rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1.5 text-sm text-sdm-text"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">Occ per species (100-100K)</label>
            <input
              type="number"
              min={100}
              max={100000}
              step={1000}
              value={customOcc}
              onChange={(e) => setCustomOcc(Math.max(100, Math.min(100000, Number(e.target.value))))}
              className="w-full rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1.5 text-sm text-sdm-text"
            />
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-sdm-muted mb-1">
          Coordinate error rate ({errorRate}%)
          <span className="text-[10px] text-sdm-muted ml-1">— injects GPS noise, sea points, zero coords to test cleaning</span>
        </label>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={errorRate}
          onChange={(e) => setErrorRate(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating {totalRecords.toLocaleString()} records...
          </>
        ) : (
          <>
            <Layers className="h-4 w-4" />
            Generate & add to workspace
          </>
        )}
      </button>

      {resultError && (
        <div className="flex items-start gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 px-3 py-2 text-xs text-sdm-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{resultError}</span>
        </div>
      )}

      {result && (
        <div
          draggable
          onDragStart={(e) => {
            const payload = JSON.stringify({
              file_id: result.file_id,
              file_name: result.file_name,
              n_rows: result.n_records,
              species: Array.isArray(result.species_names) ? result.species_names.join(", ") : "",
              format: "csv",
            });
            e.dataTransfer.setData("application/x-sdm-file", payload);
            e.dataTransfer.effectAllowed = "copy";
          }}
          className="rounded-md border border-sdm-success/30 bg-sdm-success/5 p-3 space-y-1.5 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-sdm-success">
            <CheckCircle2 className="h-4 w-4" />
            Generated successfully
          </div>
          <p className="text-xs text-sdm-text">{result.message}</p>
          <div className="flex flex-wrap gap-2 text-xs text-sdm-muted">
            <span>{result.n_species} species</span>
            <span>{result.n_records.toLocaleString()} records</span>
            {result.n_errors > 0 && <span className="text-sdm-warning">{result.n_errors} with coordinate errors</span>}
            <span>{result.raster_cells.toLocaleString()} raster cells</span>
          </div>
          {Array.isArray(result.species_names) && result.species_names.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {result.species_names.map((sp: string) => (
                <span key={sp} className="inline-flex items-center rounded bg-sdm-accent/10 px-1.5 py-0.5 text-xs text-sdm-accent">
                  {sp}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-sdm-border/50">
            <button
              onClick={handleSaveExample}
              disabled={savingExample || savedExampleName !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border bg-sdm-surface-soft px-2.5 py-1 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-50 transition-colors"
            >
              {savingExample ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : savedExampleName !== null ? (
                <CheckCircle2 className="h-3 w-3 text-sdm-success" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {savingExample ? "Saving..." : savedExampleName !== null ? "Saved to examples" : "Save to examples"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
