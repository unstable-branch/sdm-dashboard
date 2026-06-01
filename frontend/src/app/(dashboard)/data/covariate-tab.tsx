"use client";

import { useState, useCallback } from "react";
import { Download, Loader2, CheckCircle2, AlertTriangle, Info, Trash2, RefreshCw } from "lucide-react";
import { apiPost } from "@/services/api";

type CovariateType =
  | "elevation"
  | "soil"
  | "uv"
  | "vegetation"
  | "lulc"
  | "hfp"
  | "drought"
  | "bioclim_seasonality";

interface StatusMap {
  [key: string]: "idle" | "downloading" | "success" | "error";
}

export function CovariateTab() {
  const [status, setStatus] = useState<StatusMap>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Elevation
  const [demType, setDemType] = useState("COP90");
  const [opentopoKey, setOpentopoKey] = useState("");

  // Soil
  const [soilVars, setSoilVars] = useState<string[]>([]);
  const [soilDepths, setSoilDepths] = useState<string[]>([]);

  // LULC
  const [lulcYear, setLulcYear] = useState(2020);

  // HFP
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
      const result = await apiPost<{ status: string; message: string }>("/api/v1/covariates/download", {
        type, ...extra,
      });
      if (result.status === "success") {
        setStatus((prev) => ({ ...prev, [type]: "success" }));
      } else {
        setStatus((prev) => ({ ...prev, [type]: "error" }));
        setErrorMsg(result.message || `${type} download failed`);
      }
    } catch (err) {
      setStatus((prev) => ({ ...prev, [type]: "error" }));
      setErrorMsg(err instanceof Error ? err.message : `${type} download failed`);
    }
  }, []);

  const statusIcon = (t: CovariateType) => {
    const s = status[t];
    if (s === "downloading") return <Loader2 className="h-4 w-4 animate-spin text-sdm-accent" />;
    if (s === "success") return <CheckCircle2 className="h-4 w-4 text-sdm-success" />;
    if (s === "error") return <AlertTriangle className="h-4 w-4 text-sdm-danger" />;
    return null;
  };

  const sectionHeader = (icon: string, title: string) => (
    <div className="flex items-center gap-2 text-sm font-semibold text-sdm-heading mb-3">
      <span className="text-base">{icon}</span>
      {title}
    </div>
  );

  return (
    <div className="space-y-6">
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

        {/* Elevation */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">⛰️</span>
            <span>Elevation (OpenTopography)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("elevation")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.elevation === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Elevation tiles downloaded and cached
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={demType}
                onChange={(e) => setDemType(e.target.value)}
                className="rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-xs text-sdm-text outline-none"
              >
                <option value="COP90">Copernicus 90m</option>
                <option value="SRTMGL3">SRTM GL 90m</option>
                <option value="COP30">Copernicus 30m</option>
                <option value="SRTMGL1">SRTM GL 30m</option>
                <option value="NASADEM">NASA DEM</option>
                <option value="AW3D30">ALOS World 3D 30m</option>
              </select>
              <input
                type="password"
                value={opentopoKey}
                onChange={(e) => setOpentopoKey(e.target.value)}
                placeholder="OpenTopography API key"
                className="col-span-2 rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-xs text-sdm-text outline-none placeholder:text-sdm-muted"
              />
            </div>
            <p className="text-xs text-sdm-muted">
              API key required. Get a free key at{' '}
              <a href="https://opentopography.org" target="_blank" rel="noopener noreferrer"
                className="text-sdm-accent hover:underline">opentopography.org</a>
            </p>
            <button
              onClick={() => downloadCovariate("elevation", { dem_type: demType, apikey: opentopoKey })}
              disabled={status.elevation === "downloading" || !opentopoKey}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download elevation tiles
            </button>
          </div>
        </details>

        {/* Soil */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">🧪</span>
            <span>SoilGrids (ISRIC)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("soil")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.soil === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Soil layers downloaded and cached
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-sdm-heading mb-2">Variables</p>
                <div className="space-y-1.5">
                  {["bdod", "clay", "sand", "soc", "phh2o"].map((v) => (
                    <label key={v} className="flex items-center gap-2 text-xs text-sdm-text cursor-pointer">
                      <input type="checkbox" checked={soilVars.includes(v)}
                        onChange={() => toggleSoilVar(v)}
                        className="rounded border-sdm-border bg-sdm-surface-soft" />
                      {v === "bdod" ? "Bulk density (BDOD)" :
                       v === "clay" ? "Clay content" :
                       v === "sand" ? "Sand content" :
                       v === "soc" ? "Soil organic carbon (SOC)" :
                       "pH in H2O"}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-sdm-heading mb-2">Depths</p>
                <div className="space-y-1.5">
                  {[["5", "0-5cm"], ["15", "5-15cm"], ["30", "15-30cm"],
                    ["60", "30-60cm"], ["100", "60-100cm"], ["200", "100-200cm"]].map(([val, label]) => (
                    <label key={val} className="flex items-center gap-2 text-xs text-sdm-text cursor-pointer">
                      <input type="checkbox" checked={soilDepths.includes(val)}
                        onChange={() => toggleSoilDepth(val)}
                        className="rounded border-sdm-border bg-sdm-surface-soft" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={() => downloadCovariate("soil", { soil_vars: soilVars, soil_depths: soilDepths })}
              disabled={status.soil === "downloading" || soilVars.length === 0 || soilDepths.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download selected soil layers
            </button>
          </div>
        </details>

        {/* UV-B */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">☀️</span>
            <span>UV-B Radiation (glUV)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("uv")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.uv === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                UV-B layers downloaded and cached
              </div>
            )}
            <p className="text-xs text-sdm-muted">
              Downloads UV-B annual and monthly radiation layers from the UFZ glUV archive.
            </p>
            <button
              onClick={() => downloadCovariate("uv")}
              disabled={status.uv === "downloading"}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download UV-B layers
            </button>
          </div>
        </details>

        {/* Vegetation */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">🌿</span>
            <span>Vegetation (GIMMS NDVI/EVI)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("vegetation")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.vegetation === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Vegetation layers downloaded and cached
              </div>
            )}
            <p className="text-xs text-sdm-muted">
              Downloads GIMMS NDVI and AVHRR EVI. LAI/GPP require Google Earth Engine (rgee).
            </p>
            <button
              onClick={() => downloadCovariate("vegetation")}
              disabled={status.vegetation === "downloading"}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download GIMMS NDVI
            </button>
          </div>
        </details>

        {/* LULC */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">🗺️</span>
            <span>LULC (MODIS MCD12Q1)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("lulc")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.lulc === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                LULC layers downloaded and cached
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="text-xs text-sdm-muted">Year:</label>
              <select
                value={lulcYear}
                onChange={(e) => setLulcYear(Number(e.target.value))}
                className="rounded-md border border-sdm-border bg-sdm-surface px-2 py-1.5 text-xs text-sdm-text outline-none"
              >
                {Array.from({ length: 23 }, (_, i) => 2001 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => downloadCovariate("lulc", { lulc_year: lulcYear })}
              disabled={status.lulc === "downloading"}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download LULC year
            </button>
          </div>
        </details>

        {/* Human Footprint */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">👣</span>
            <span>Human Footprint (WCS)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("hfp")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.hfp === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Human footprint layers downloaded and cached
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="text-xs text-sdm-muted">Year:</label>
              <select
                value={hfpYear}
                onChange={(e) => setHfpYear(Number(e.target.value))}
                className="rounded-md border border-sdm-border bg-sdm-surface px-2 py-1.5 text-xs text-sdm-text outline-none"
              >
                {Array.from({ length: 20 }, (_, i) => 2001 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => downloadCovariate("hfp", { hfp_year: hfpYear })}
              disabled={status.hfp === "downloading"}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download HFP year
            </button>
          </div>
        </details>

        {/* Drought */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">🏜️</span>
            <span>Drought Index (CRU scPDSI)</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("drought")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.drought === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Drought layers downloaded and cached
              </div>
            )}
            <div className="space-y-1.5">
              {[["annual_mean", "Annual mean"], ["wet_season", "Wet season (Dec-Feb)"], ["dry_season", "Dry season (Jun-Aug)"]].map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 text-xs text-sdm-text cursor-pointer">
                  <input type="checkbox" checked={droughtPeriods.includes(val)}
                    onChange={() => toggleDroughtPeriod(val)}
                    className="rounded border-sdm-border bg-sdm-surface-soft" />
                  {label}
                </label>
              ))}
            </div>
            <button
              onClick={() => downloadCovariate("drought", { drought_periods: droughtPeriods })}
              disabled={status.drought === "downloading" || droughtPeriods.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download drought layers
            </button>
          </div>
        </details>

        {/* Bioclimatic Seasonality */}
        <details className="group mb-4 rounded-lg border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-sdm-text hover:bg-sdm-surface/50 rounded-lg [&::-webkit-details-marker]:hidden">
            <span className="text-base">📊</span>
            <span>Bioclimatic Seasonality</span>
            <span className="ml-auto flex items-center gap-2">{statusIcon("bioclim_seasonality")}</span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            {status.bioclim_seasonality === "success" && (
              <div className="flex items-center gap-2 text-xs text-sdm-success font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Seasonality layers downloaded and cached
              </div>
            )}
            <p className="text-xs text-sdm-muted">
              GDD5, GDD10, Annual Moisture Index, and Precipitation Seasonality from WorldClim monthly data.
            </p>
            <button
              onClick={() => downloadCovariate("bioclim_seasonality")}
              disabled={status.bioclim_seasonality === "downloading"}
              className="inline-flex items-center gap-2 rounded-md border border-sdm-border px-3 py-1.5 text-xs font-medium text-sdm-text hover:bg-sdm-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download seasonality
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
