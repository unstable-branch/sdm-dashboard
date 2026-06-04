"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, Upload, Trash2, Loader2, CheckCircle2, AlertTriangle, Globe, RefreshCw } from "lucide-react";
import { apiGet, apiPost, apiDelete, apiUpload } from "@/services/api";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface BoundaryFile {
  file_path: string;
  file_name: string;
  file_size: number;
  modified_at: string;
}

export function BoundaryTab() {
  const [type, setType] = useState<"admin0" | "land">("admin0");
  const [resolution, setResolution] = useState("110m");
  const [country, setCountry] = useState("all");
  const [countries, setCountries] = useState<string[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  type DownloadStatus = "idle" | "downloading" | "success" | "error";
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("idle");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const [boundaries, setBoundaries] = useState<BoundaryFile[]>([]);
  const [boundariesLoading, setBoundariesLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchBoundaries = useCallback(async () => {
    setBoundariesLoading(true);
    try {
      const data = await apiGet<{ boundaries: BoundaryFile[] }>("/api/v1/data/boundary/list");
      setBoundaries(data.boundaries || []);
    } catch {
      setBoundaries([]);
    } finally {
      setBoundariesLoading(false);
    }
  }, []);

  const fetchCountries = useCallback(async () => {
    setCountriesLoading(true);
    try {
      const data = await apiGet<{ countries: string[] }>("/api/v1/data/boundary/countries");
      setCountries(data.countries || []);
    } catch {
      setCountries([]);
    } finally {
      setCountriesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoundaries();
  }, [fetchBoundaries]);

  useEffect(() => {
    if (type === "admin0") {
      fetchCountries();
    }
  }, [type, fetchCountries]);

  const handleDownload = async () => {
    setDownloadStatus("downloading");
    setDownloadMessage(null);
    try {
      const result = await apiPost<{ status: string; message: string }>("/api/v1/data/boundary/download", {
        type, resolution, country,
      });
      if (result.status === "success") {
        setDownloadStatus("success");
        setDownloadMessage(result.message || "Boundary downloaded");
        fetchBoundaries();
      } else {
        setDownloadStatus("error");
        setDownloadMessage(result.message || "Download failed");
      }
    } catch (err) {
      setDownloadStatus("error");
      setDownloadMessage(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadLoading(true);
    setUploadError(null);
    setUploadSuccess(false);
    try {
      await apiUpload("/api/v1/data/boundary/upload", uploadFile);
      setUploadSuccess(true);
      setUploadFile(null);
      fetchBoundaries();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDelete = async (filePath: string) => {
    setDeleteLoading(filePath);
    try {
      await apiDelete(`/api/v1/data/boundary/delete/${encodeURIComponent(filePath)}`);
      setBoundaries((prev) => prev.filter((b) => b.file_path !== filePath));
      setConfirmDelete(null);
    } catch {
      // swallow
    } finally {
      setDeleteLoading(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Download section */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h2 className="text-lg font-semibold text-sdm-heading mb-1">Download Natural Earth Boundary</h2>
        <p className="text-sm text-sdm-muted mb-4">
          Download country or coastline boundaries for use in model masking.
        </p>

        {downloadStatus === "error" && downloadMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{downloadMessage}</span>
          </div>
        )}

        {downloadStatus === "success" && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-sdm-success/30 bg-sdm-success/5 p-3 text-sm text-sdm-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{downloadMessage || "Boundary downloaded and ready for model use"}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "admin0" | "land")}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
            >
              <option value="admin0">Admin 0 Countries</option>
              <option value="land">Coastline (land)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
            >
              <option value="110m">1:110m (~18 km)</option>
              <option value="50m">1:50m (~9 km)</option>
              <option value="10m">1:10m (~1.8 km)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">Country</label>
            <SearchableSelect
              options={["all", ...countries]}
              value={country}
              onChange={setCountry}
              placeholder="Search countries..."
              disabled={type !== "admin0"}
              loading={countriesLoading}
              allLabel="All countries"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleDownload}
              disabled={downloadStatus === "downloading"}
              className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50"
            >
              {downloadStatus === "downloading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : downloadStatus === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloadStatus === "downloading" ? "Downloading..." :
               downloadStatus === "success" ? "Downloaded" :
               "Download to Server"}
            </button>
          </div>
        </div>
      </div>

      {/* Upload section */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h2 className="text-lg font-semibold text-sdm-heading mb-1">Upload Custom Boundary</h2>
        <p className="text-sm text-sdm-muted mb-4">
          Upload a custom GeoJSON boundary file for use in model masking.
        </p>

        {uploadError && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {uploadSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-sdm-success/30 bg-sdm-success/5 p-3 text-sm text-sdm-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Boundary uploaded successfully</span>
          </div>
        )}

        <div className="flex items-end gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-sdm-muted mb-1">GeoJSON file</label>
            <input
              type="file"
              accept=".geojson,.json,.kml,.gpkg,.zip"
              onChange={(e) => {
                setUploadFile(e.target.files?.[0] || null);
                setUploadSuccess(false);
              }}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text file:mr-3 file:rounded file:border-0 file:bg-sdm-accent file:px-2 file:py-1 file:text-xs file:text-white"
            />
            <p className="mt-1 text-xs text-sdm-muted">Accepted: .geojson, .json, .kml, .gpkg, .zip (shapefiles: zip .shp + .shx + .dbf + .prj together)</p>
          </div>
          <button
            onClick={handleUpload}
            disabled={!uploadFile || uploadLoading}
            className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50"
          >
            {uploadLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploadLoading ? "Uploading..." : "Upload"}
          </button>
        </div>

        {/* Downloaded boundaries list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-sdm-heading">Downloaded boundaries</h3>
            <button
              onClick={fetchBoundaries}
              disabled={boundariesLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-sdm-border/50 px-2.5 py-1 text-xs font-medium text-sdm-muted hover:text-sdm-text hover:bg-sdm-surface transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${boundariesLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          {boundariesLoading && boundaries.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-sdm-muted py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : boundaries.length === 0 ? (
            <p className="text-sm text-sdm-muted py-4">No boundaries downloaded yet.</p>
          ) : (
            <div className="space-y-2">
              {boundaries.map((b) => (
                <div key={b.file_path}
                  className="flex items-center justify-between rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Globe className="h-4 w-4 shrink-0 text-sdm-accent" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-sdm-text truncate">{b.file_name}</p>
                      <p className="text-xs text-sdm-muted">
                        {formatSize(b.file_size)} &middot; {b.modified_at?.slice(0, 10) || "—"}
                      </p>
                    </div>
                  </div>
                  {confirmDelete === b.file_path ? (
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <span className="flex items-center gap-1 text-xs text-sdm-danger font-medium">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Delete?
                      </span>
                      <button
                        onClick={() => handleDelete(b.file_path)}
                        disabled={deleteLoading === b.file_path}
                        className="rounded bg-sdm-danger px-2 py-1 text-xs font-medium text-white hover:bg-sdm-danger/90 disabled:opacity-40 transition-colors"
                      >
                        {deleteLoading === b.file_path ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : "Yes"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        disabled={deleteLoading === b.file_path}
                        className="rounded border border-sdm-border/50 px-2 py-1 text-xs font-medium text-sdm-muted hover:text-sdm-text transition-colors disabled:opacity-40"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(b.file_path)}
                      className="ml-3 rounded p-1.5 text-sdm-muted hover:text-sdm-danger hover:bg-sdm-danger/10 transition-colors shrink-0"
                      title="Delete boundary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}