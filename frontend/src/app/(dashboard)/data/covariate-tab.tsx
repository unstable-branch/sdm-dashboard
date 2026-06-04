"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Download, Loader2, CheckCircle2, AlertTriangle,
  Mountain, FlaskConical, Sun, Leaf, Map, Footprints, Thermometer, BarChart3,
} from "lucide-react";
import { apiGet, apiPost } from "@/services/api";
import { DownloadProgress } from "@/components/climate/download-progress";

type CovariateType =
  | "elevation" | "soil" | "uv" | "vegetation"
  | "lulc" | "hfp" | "drought" | "bioclim_seasonality";

interface StatusMap {
  [key: string]: "idle" | "downloading" | "success" | "error";
}

interface CovariateMeta {
  id: CovariateType;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  docLink?: string;
}

const COVARIATE_TYPES: CovariateMeta[] = [
  { id: "elevation", icon: <Mountain className="h-5 w-5" />, title: "Elevation", subtitle: "OpenTopography DEM", docLink: "https://opentopography.org" },
  { id: "soil", icon: <FlaskConical className="h-5 w-5" />, title: "SoilGrids", subtitle: "ISRIC soil properties" },
  { id: "uv", icon: <Sun className="h-5 w-5" />, title: "UV-B Radiation", subtitle: "glUV archive" },
  { id: "vegetation", icon: <Leaf className="h-5 w-5" />, title: "Vegetation", subtitle: "GIMMS NDVI/EVI" },
  { id: "lulc", icon: <Map className="h-5 w-5" />, title: "LULC", subtitle: "MODIS MCD12Q1" },
  { id: "hfp", icon: <Footprints className="h-5 w-5" />, title: "Human Footprint", subtitle: "WCS" },
  { id: "drought", icon: <Thermometer className="h-5 w-5" />, title: "Drought Index", subtitle: "CRU scPDSI" },
  { id: "bioclim_seasonality", icon: <BarChart3 className="h-5 w-5" />, title: "Bioclimatic Seasonality", subtitle: "WorldClim monthly" },
];

function StatusBadge({ status }: { status: string }) {
  if (!status || status === "idle" || status === "downloading") return null;
  const colors: Record<string, string> = {
    success: "bg-green-500/10 text-green-400",
    error: "bg-red-500/10 text-red-400",
  };
  const labels: Record<string, string> = {
    success: "Downloaded",
    error: "Failed",
  };
  const dots: Record<string, string> = {
    success: "bg-green-400",
    error: "bg-red-400",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[status]}`} />
      {labels[status]}
    </span>
  );
}

export function CovariateTab() {
  const [status, setStatus] = useState<StatusMap>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [showSoilOptions, setShowSoilOptions] = useState(false);

  // Elevation
  const [demType, setDemType] = useState("COP90");
  const [opentopoKey, setOpentopoKey] = useState("");
  useEffect(() => {
    apiGet<{ value: string }>("/api/v1/admin/system/secrets/service.open_topography_api_key?raw=1")
      .then((data) => { if (data?.value) setOpentopoKey(data.value); })
      .catch(() => {});
  }, []);

  // Soil
  const [soilVars, setSoilVars] = useState<string[]>([]);
  const [soilDepths, setSoilDepths] = useState<string[]>([]);

  // LULC / HFP
  const [lulcYear, setLulcYear] = useState(2020);
  const [hfpYear, setHfpYear] = useState(2020);

  // Drought
  const [droughtPeriods, setDroughtPeriods] = useState<string[]>([]);

  const toggleSoilVar = (v: string) =>
    setSoilVars((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  const toggleSoilDepth = (d: string) =>
    setSoilDepths((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  const toggleDroughtPeriod = (p: string) =>
    setDroughtPeriods((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const downloadCovariate = useCallback(async (type: CovariateType, extra: Record<string, unknown> = {}) => {
    setStatus((prev) => ({ ...prev, [type]: "downloading" }));
    setErrorMsg(null);
    try {
      const result = await apiPost<{ jobId: string; status: string }>("/api/v1/covariates/download_bg", {
        type, ...extra,
      });
      if (result.jobId) {
        setActiveJob(result.jobId);
      } else {
        setStatus((prev) => ({ ...prev, [type]: "error" }));
        setErrorMsg("Download did not return a job ID");
      }
    } catch (err) {
      setStatus((prev) => ({ ...prev, [type]: "error" }));
      setErrorMsg(err instanceof Error ? err.message : `${type} download failed`);
    }
  }, []);

  const handleComplete = useCallback(async () => { setActiveJob(null); }, []);
  const handleFailed = useCallback(async () => { setActiveJob(null); }, []);
  const handleCancel = useCallback(async () => {
    if (activeJob) { try { await apiPost(`/api/v1/climate/cancel/${activeJob}`); } catch { } }
    setActiveJob(null);
  }, [activeJob]);

  const renderCard = (meta: CovariateMeta) => {
    const s = status[meta.id];
    const isDownloading = s === "downloading";
    const disabled = !!activeJob;

    return (
      <div key={meta.id} className="rounded-lg border border-sdm-border/50 bg-sdm-surface-soft p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sdm-surface text-sdm-accent">
              {meta.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-sdm-text truncate">{meta.title}</p>
              <p className="text-xs text-sdm-muted truncate">{meta.subtitle}</p>
            </div>
          </div>
          <StatusBadge status={s} />
        </div>

        {/* Type-specific controls */}
        {meta.id === "elevation" && (
          <>
            <select value={demType} onChange={(e) => setDemType(e.target.value)}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              <option value="COP90">Copernicus 90m</option>
              <option value="SRTMGL3">SRTM GL 90m</option>
              <option value="COP30">Copernicus 30m</option>
              <option value="SRTMGL1">SRTM GL 30m</option>
              <option value="NASADEM">NASA DEM</option>
              <option value="AW3D30">ALOS World 3D 30m</option>
            </select>
            <input type="password" value={opentopoKey} onChange={(e) => setOpentopoKey(e.target.value)}
              placeholder="OpenTopography API key"
              className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text placeholder:text-sdm-muted" />
            {meta.docLink && (
              <p className="text-xs text-sdm-muted">
                Get a free key at{" "}
                <a href={meta.docLink} target="_blank" rel="noopener noreferrer"
                  className="text-sdm-accent hover:underline">{meta.docLink.replace("https://", "")}</a>
              </p>
            )}
            <button onClick={() => downloadCovariate("elevation", { dem_type: demType, apikey: opentopoKey })}
              disabled={disabled || !opentopoKey}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download elevation"}
            </button>
          </>
        )}

        {meta.id === "soil" && (
          <>
            <button onClick={() => setShowSoilOptions(!showSoilOptions)}
              className="w-full flex items-center justify-between rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft transition-colors">
              <span className="text-sdm-muted">
                {soilVars.length > 0 || soilDepths.length > 0
                  ? `${soilVars.length} vars, ${soilDepths.length} depths`
                  : "Configure layers"}
              </span>
              <span className={`text-sdm-muted transition-transform ${showSoilOptions ? "rotate-180" : ""}`}>▾</span>
            </button>
            {showSoilOptions && (
              <div className="space-y-2 text-xs">
                <div>
                  <p className="font-medium text-sdm-heading mb-1.5">Variables</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["bdod", "clay", "sand", "soc", "phh2o"].map((v) => (
                      <label key={v}
                        className={`px-2 py-1 rounded cursor-pointer border transition-colors ${
                          soilVars.includes(v)
                            ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                            : "border-sdm-border text-sdm-muted hover:border-sdm-accent/50"}`}>
                        <input type="checkbox" checked={soilVars.includes(v)}
                          onChange={() => toggleSoilVar(v)} className="sr-only" />
                        {v === "bdod" ? "Bulk density" : v === "phh2o" ? "pH" : v}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-medium text-sdm-heading mb-1.5">Depths</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[["5", "0-5cm"], ["15", "5-15cm"], ["30", "15-30cm"],
                      ["60", "30-60cm"], ["100", "60-100cm"], ["200", "100-200cm"]].map(([val, label]) => (
                      <label key={val}
                        className={`px-2 py-1 rounded cursor-pointer border transition-colors ${
                          soilDepths.includes(val)
                            ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                            : "border-sdm-border text-sdm-muted hover:border-sdm-accent/50"}`}>
                        <input type="checkbox" checked={soilDepths.includes(val)}
                          onChange={() => toggleSoilDepth(val)} className="sr-only" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button onClick={() => downloadCovariate("soil", { soil_vars: soilVars, soil_depths: soilDepths })}
              disabled={disabled || soilVars.length === 0 || soilDepths.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download soil layers"}
            </button>
          </>
        )}

        {meta.id === "uv" && (
          <>
            <p className="text-xs text-sdm-muted">UV-B annual and monthly radiation layers from the UFZ glUV archive.</p>
            <button onClick={() => downloadCovariate("uv")} disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download UV-B"}
            </button>
          </>
        )}

        {meta.id === "vegetation" && (
          <>
            <p className="text-xs text-sdm-muted">GIMMS NDVI and AVHRR EVI. LAI/GPP require rgee.</p>
            <button onClick={() => downloadCovariate("vegetation")} disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download GIMMS NDVI"}
            </button>
          </>
        )}

        {meta.id === "lulc" && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-sdm-muted shrink-0">Year:</label>
              <select value={lulcYear} onChange={(e) => setLulcYear(Number(e.target.value))}
                className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {Array.from({ length: 23 }, (_, i) => 2001 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button onClick={() => downloadCovariate("lulc", { lulc_year: lulcYear })} disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download LULC"}
            </button>
          </>
        )}

        {meta.id === "hfp" && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-sdm-muted shrink-0">Year:</label>
              <select value={hfpYear} onChange={(e) => setHfpYear(Number(e.target.value))}
                className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {Array.from({ length: 20 }, (_, i) => 2001 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button onClick={() => downloadCovariate("hfp", { hfp_year: hfpYear })} disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download HFP"}
            </button>
          </>
        )}

        {meta.id === "drought" && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[["annual_mean", "Annual mean"], ["wet_season", "Wet season"], ["dry_season", "Dry season"]].map(([val, label]) => (
                <label key={val}
                  className={`px-2 py-1 rounded text-xs cursor-pointer border transition-colors ${
                    droughtPeriods.includes(val)
                      ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                      : "border-sdm-border text-sdm-muted hover:border-sdm-accent/50"}`}>
                  <input type="checkbox" checked={droughtPeriods.includes(val)}
                    onChange={() => toggleDroughtPeriod(val)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>
            <button onClick={() => downloadCovariate("drought", { drought_periods: droughtPeriods })}
              disabled={disabled || droughtPeriods.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download drought"}
            </button>
          </>
        )}

        {meta.id === "bioclim_seasonality" && (
          <>
            <p className="text-xs text-sdm-muted">GDD5, GDD10, AMI, and Precipitation Seasonality from monthly data.</p>
            <button onClick={() => downloadCovariate("bioclim_seasonality")} disabled={disabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloading ? "Downloading..." : "Download seasonality"}
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {activeJob && (
        <DownloadProgress
          jobId={activeJob}
          onComplete={handleComplete}
          onFailed={handleFailed}
          onCancel={handleCancel}
        />
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6">
        <h2 className="text-lg font-semibold text-sdm-heading mb-1">Download Covariate Layers</h2>
        <p className="text-sm text-sdm-muted mb-4">
          Download additional environmental layers beyond climate data. These are cached locally and
          included in model runs when the corresponding option is enabled.
        </p>

        {errorMsg && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {COVARIATE_TYPES.map(renderCard)}
        </div>
      </div>
    </div>
  );
}
