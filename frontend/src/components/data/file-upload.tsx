"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, AlertCircle } from "lucide-react";
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

export function FileUpload({ onUpload, loading, error }: FileUploadProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
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
        <Upload className="mx-auto h-10 w-10 text-sdm-muted mb-3" />
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
    </div>
  );
}
