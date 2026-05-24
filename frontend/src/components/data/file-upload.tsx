"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, FileArchive, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUpload: (file: File) => void;
  loading?: boolean;
  error?: string | null;
}

const ACCEPTED_TYPES = {
  "text/csv": [".csv"],
  "text/tab-separated-values": [".tsv", ".txt"],
  "application/zip": [".zip"],
};

const FILE_ICONS: Record<string, typeof FileText> = {
  csv: FileText,
  tsv: FileText,
  txt: FileText,
  zip: FileArchive,
};

export function FileUpload({ onUpload, loading, error }: FileUploadProps) {
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setUploadResult(null);
        onUpload(acceptedFiles[0]);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    disabled: loading,
  });

  const detectedFormat = uploadResult?.format as string | undefined;
  const FileIcon = detectedFormat ? FILE_ICONS[detectedFormat] || FileText : Upload;

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
          isDragActive && !isDragReject
            ? "border-sdm-accent bg-sdm-accent/5"
            : isDragReject
            ? "border-sdm-danger bg-sdm-danger/5"
            : "border-sdm-border hover:border-sdm-accent/50 hover:bg-sdm-surface-soft/50",
          loading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input {...getInputProps()} />
        <FileIcon className="mx-auto h-10 w-10 text-sdm-muted mb-3" />
        {loading ? (
          <p className="text-sdm-muted">Processing file...</p>
        ) : isDragActive ? (
          <p className="text-sdm-accent font-medium">Drop the file here</p>
        ) : (
          <div>
            <p className="text-sdm-text font-medium">
              Drag & drop a file, or <span className="text-sdm-accent">browse</span>
            </p>
            <p className="text-sm text-sdm-muted mt-1">
              CSV, TSV, or ZIP (Darwin Core Archive)
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {uploadResult && (
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileIcon className="h-4 w-4 text-sdm-accent" />
            <span className="font-medium text-sdm-heading">{String(uploadResult.filename)}</span>
            <span className="text-xs text-sdm-muted uppercase">{String(uploadResult.format)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-sdm-muted">Records:</span>{" "}
              <span className="font-medium text-sdm-text">{String(uploadResult.n_rows)}</span>
            </div>
            {uploadResult.species_detected != null && String(uploadResult.species_detected) !== "null" ? (
              <div>
                <span className="text-sdm-muted">Species:</span>{" "}
                <span className="font-medium text-sdm-text">{String(uploadResult.species_detected)}</span>
              </div>
            ) : null}
            {uploadResult.doi != null && String(uploadResult.doi) !== "null" ? (
              <div className="col-span-2">
                <span className="text-sdm-muted">DOI:</span>{" "}
                <span className="font-mono text-xs text-sdm-accent-blue">{String(uploadResult.doi)}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
