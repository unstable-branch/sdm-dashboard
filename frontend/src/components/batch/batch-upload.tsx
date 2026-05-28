"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";

interface BatchUploadProps {
  onConfigsParsed: (configs: Array<Record<string, unknown>>) => void;
}

export function BatchUpload({ onConfigsParsed }: BatchUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<number>(0);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    const file = acceptedFiles[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.trim().split("\n");
        if (lines.length < 2) {
          setError("CSV must have a header row and at least one data row");
          return;
        }

        const headers = lines[0].split(",").map((h) => h.trim());
        const requiredCols = ["species", "occurrences_csv", "model_id"];
        const missing = requiredCols.filter((col) => !headers.includes(col));
        if (missing.length > 0) {
          setError(`Missing required columns: ${missing.join(", ")}`);
          return;
        }

        const configs: Array<Record<string, unknown>> = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(",").map((v) => v.trim());
          if (values.length !== headers.length) continue;

          const row: Record<string, unknown> = {};
          headers.forEach((h, idx) => {
            const val = values[idx];
            if (h === "biovars" || h === "soil_vars" || h === "soil_depths" || h === "uv_vars") {
              row[h] = val.split(";").map((v) => v.trim());
            } else if (["background_n", "cv_folds", "aggregation_factor", "seed", "n_cores", "worldclim_res"].includes(h)) {
              row[h] = parseInt(val, 10) || undefined;
            } else if (["threshold", "cv_block_size_km", "maxnet_regmult"].includes(h)) {
              row[h] = parseFloat(val) || undefined;
            } else if (["include_quadratic", "use_elevation", "use_soil", "use_uv", "use_vegetation", "use_lulc", "use_hfp", "vif_reduction", "future_projection"].includes(h)) {
              row[h] = ["true", "1", "yes"].includes(val.toLowerCase());
            } else if (val && val !== "NA" && val !== "") {
              row[h] = val;
            }
          });

          if (row.species && row.occurrences_csv && row.model_id) {
            configs.push(row);
          }
        }

        if (configs.length === 0) {
          setError("No valid configs found in CSV");
          return;
        }

        setParsed(configs.length);
        onConfigsParsed(configs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse CSV");
      }
    };
    reader.readAsText(file);
  }, [onConfigsParsed]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    multiple: false,
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-sdm-accent bg-sdm-accent/5"
            : "border-sdm-border bg-sdm-surface hover:border-sdm-accent/50"
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="h-8 w-8 mx-auto mb-3 text-sdm-muted" />
        <p className="text-sm text-sdm-text">
          {isDragActive ? "Drop your CSV file here" : "Drop your batch config CSV here, or click to browse"}
        </p>
        <p className="text-xs text-sdm-muted mt-1">
          Required columns: species, occurrences_csv, model_id
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {parsed > 0 && (
        <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-400 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Parsed {parsed} species configs from CSV
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
        <h4 className="text-xs font-semibold text-sdm-heading mb-2 uppercase tracking-wide flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          CSV Format
        </h4>
        <pre className="text-xs text-sdm-muted font-mono bg-sdm-surface-soft p-3 rounded overflow-x-auto">
{`species,occurrences_csv,model_id,biovars,background_n,cv_folds,threshold
Acacia mearnsii,data/acacia.csv,glm,"1;4;6;12;15;18",10000,3,0.5
Eucalyptus globulus,data/eucalyptus.csv,maxnet,"1;4;6;12",10000,3,0.5`}
        </pre>
      </div>
    </div>
  );
}
