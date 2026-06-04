"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/services/api";
import { Cloud, Globe, Map, Mountain, Upload, CheckCircle2, AlertTriangle, Loader2, FlaskConical, Sun, Leaf, Map as MapIcon, Footprints, Thermometer, BarChart3 } from "lucide-react";

interface ClimateScenario {
  id: string;
  type: "future" | "current";
  gcm?: string;
  ssp?: string;
  period?: string;
  source?: "worldclim" | "chelsa";
}

interface BoundaryFile {
  file_path: string;
  file_name: string;
  file_size: number;
}

interface OverviewTabProps {
  uploadResult: Record<string, unknown> | null;
  cleanResult: Record<string, unknown> | null;
  species: string;
  recordCount: number;
  hasGbifCredentials: boolean;
}

const COVARIATE_TYPES = [
  { id: "elevation", icon: <Mountain className="h-4 w-4" />, label: "Elevation" },
  { id: "soil", icon: <FlaskConical className="h-4 w-4" />, label: "SoilGrids" },
  { id: "uv", icon: <Sun className="h-4 w-4" />, label: "UV-B" },
  { id: "vegetation", icon: <Leaf className="h-4 w-4" />, label: "Vegetation" },
  { id: "lulc", icon: <MapIcon className="h-4 w-4" />, label: "LULC" },
  { id: "hfp", icon: <Footprints className="h-4 w-4" />, label: "HFP" },
  { id: "drought", icon: <Thermometer className="h-4 w-4" />, label: "Drought" },
  { id: "bioclim_seasonality", icon: <BarChart3 className="h-4 w-4" />, label: "Seasonality" },
];

export function OverviewTab({ uploadResult, cleanResult, species, recordCount, hasGbifCredentials }: OverviewTabProps) {
  const [scenarios, setScenarios] = useState<ClimateScenario[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [boundaries, setBoundaries] = useState<BoundaryFile[]>([]);
  const [boundariesLoading, setBoundariesLoading] = useState(true);
  const [climateCheck, setClimateCheck] = useState<{ available: number[]; missing: number[] } | null>(null);
  const [climateCheckLoading, setClimateCheckLoading] = useState(true);

  useEffect(() => {
    apiGet<{ scenarios: ClimateScenario[] }>("/api/v1/climate/scenarios")
      .then((d) => setScenarios(d.scenarios || []))
      .catch(() => {})
      .finally(() => setScenariosLoading(false));
    apiGet<{ boundaries: BoundaryFile[] }>("/api/v1/data/boundary/list")
      .then((d) => setBoundaries(d.boundaries || []))
      .catch(() => {})
      .finally(() => setBoundariesLoading(false));
    apiGet<{ available: number[]; missing: number[] }>("/api/v1/climate/check?source=worldclim&res=10&biovars=1,4,6,12,15,18")
      .then((d) => setClimateCheck(d))
      .catch(() => {})
      .finally(() => setClimateCheckLoading(false));
  }, []);

  const hasOccurrences = !!(uploadResult?.file_id || recordCount > 0);
  const isCleaned = !!cleanResult?.valid_records;
  const validRecordCount = (cleanResult?.valid_records as number) || recordCount || 0;
  const futureScenarios = scenarios.filter((s) => s.type === "future");
  const currentScenarios = scenarios.filter((s) => s.type === "current");

  const readinessItems = [
    { label: "Occurrence data loaded", ok: hasOccurrences, detail: hasOccurrences ? `${validRecordCount.toLocaleString()} records` : "Upload data in the Upload tab" },
    { label: "Data cleaned", ok: isCleaned, detail: isCleaned ? `${validRecordCount.toLocaleString()} valid records` : "Clean data before modeling" },
    { label: "Species selected", ok: !!species && species !== "Untitled species", detail: species || "Select a species on the Model page" },
    { label: "Climate layers ready", ok: !!(climateCheck?.available?.length), detail: climateCheck ? `${climateCheck.available.length} of 6 BIO layers available` : "Check climate downloads" },
    { label: "GBIF credentials", ok: hasGbifCredentials, detail: hasGbifCredentials ? "Connected" : "Set up in Settings" },
  ];

  return (
    <div className="space-y-6">
      {/* Occurrence Data */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Occurrence Data</h3>
          </div>
          {hasOccurrences ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-sdm-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Loaded
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-sdm-muted">
              <AlertTriangle className="h-3.5 w-3.5" /> None
            </span>
          )}
        </div>
        {hasOccurrences ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><span className="text-sdm-muted">Records:</span> <span className="font-medium text-sdm-text">{validRecordCount.toLocaleString()}</span></div>
            <div><span className="text-sdm-muted">Species:</span> <span className="font-medium text-sdm-text">{species}</span></div>
            <div><span className="text-sdm-muted">Cleaned:</span> <span className={`font-medium ${isCleaned ? "text-sdm-success" : "text-sdm-warning"}`}>{isCleaned ? "Yes" : "No"}</span></div>
            <div><span className="text-sdm-muted">Source:</span> <span className="font-medium text-sdm-text">{(uploadResult?.source as string) || "Upload"}</span></div>
          </div>
        ) : (
          <p className="text-sm text-sdm-muted">No occurrence data loaded yet. Upload a CSV or search GBIF on the Upload or GBIF tabs.</p>
        )}
      </div>

      {/* Climate Data */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Climate Data</h3>
          </div>
          {climateCheckLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto text-sdm-muted" />
          ) : (
            <span className={`ml-auto flex items-center gap-1.5 text-xs font-medium ${(climateCheck?.available?.length || 0) > 0 ? "text-sdm-success" : "text-sdm-muted"}`}>
              {(climateCheck?.available?.length || 0) > 0 ? `${climateCheck!.available.length} layers` : "None"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-sdm-muted">Available BIO:</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {climateCheckLoading ? (
                <span className="text-xs text-sdm-muted">Checking...</span>
              ) : climateCheck?.available?.length ? (
                climateCheck.available.slice(0, 10).map((b) => (
                  <span key={b} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400">BIO{b}</span>
                ))
              ) : (
                <span className="text-xs text-sdm-muted">No layers — download in Climate tab</span>
              )}
            </div>
          </div>
          <div>
            <span className="text-sdm-muted">Future scenarios:</span>
            <p className="mt-0.5 font-medium text-sdm-text">{futureScenarios.length} downloaded</p>
          </div>
          <div>
            <span className="text-sdm-muted">Current climate:</span>
            <p className="mt-0.5 font-medium text-sdm-text">{currentScenarios.length > 0 ? `${currentScenarios.length} source(s)` : "Not downloaded"}</p>
          </div>
        </div>
      </div>

      {/* Covariates */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Mountain className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Covariates</h3>
          </div>
          <span className="ml-auto text-xs text-sdm-muted">Download in Covariates tab</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {COVARIATE_TYPES.map((ct) => (
            <div key={ct.id} className="flex items-center gap-2 rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-3 py-2 text-xs text-sdm-muted">
              <span className="text-sdm-accent shrink-0">{ct.icon}</span>
              {ct.label}
            </div>
          ))}
        </div>
        <p className="text-xs text-sdm-muted mt-2">Covariate download status is shown per-layer in the Covariates tab after downloading.</p>
      </div>

      {/* Boundaries */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Map className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Boundaries</h3>
          </div>
          {boundariesLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto text-sdm-muted" />
          ) : (
            <span className={`ml-auto flex items-center gap-1.5 text-xs font-medium ${boundaries.length > 0 ? "text-sdm-success" : "text-sdm-muted"}`}>
              {boundaries.length} file{boundaries.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {boundaries.length > 0 ? (
          <div className="space-y-1.5">
            {boundaries.slice(0, 5).map((b) => (
              <div key={b.file_path} className="flex items-center gap-2 text-xs text-sdm-muted">
                <Map className="h-3 w-3 shrink-0" />
                <span className="truncate">{b.file_name}</span>
              </div>
            ))}
            {boundaries.length > 5 && <p className="text-xs text-sdm-muted">...and {boundaries.length - 5} more</p>}
          </div>
        ) : (
          <p className="text-sm text-sdm-muted">No boundaries downloaded. Download NE or custom boundaries in the Boundary tab.</p>
        )}
      </div>

      {/* Readiness Check */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sdm-heading">Model Readiness</h3>
          </div>
        </div>
        <div className="space-y-2">
          {readinessItems.map((item) => (
            <div key={item.label} className="flex items-center gap-3 text-sm">
              {item.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-sdm-success" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-sdm-warning" />
              )}
              <span className="text-sdm-text">{item.label}</span>
              <span className="ml-auto text-xs text-sdm-muted">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
