"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/services/api";
import {
  Cloud, Globe, Map, Mountain, Upload, CheckCircle2, AlertTriangle, Loader2,
  ArrowRight, FlaskConical, Sun, Leaf, Map as MapIcon, Footprints, Thermometer, BarChart3,
} from "lucide-react";
import type { UploadFile } from "@/services/types";

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
  climateSource: string;
  climateRes: number;
  onTabChange: (tab: string) => void;
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

function FormatBadge({ format }: { format?: string }) {
  if (!format) return null;
  const colors: Record<string, string> = {
    dwca: "bg-blue-500/10 text-blue-400",
    csv: "bg-green-500/10 text-green-400",
    tsv: "bg-amber-500/10 text-amber-400",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${colors[format] || "bg-gray-500/10 text-gray-400"}`}>
      {format.toUpperCase()}
    </span>
  );
}

function NavButton({ tab }: { tab: string }) {
  return (
    <a href={`/data?tab=${tab}`} className="flex h-7 w-7 items-center justify-center rounded-md text-sdm-muted hover:text-sdm-text hover:bg-sdm-surface-soft transition-colors" title={`Go to ${tab}`}>
      <ArrowRight className="h-4 w-4" />
    </a>
  );
}

export function OverviewTab({ uploadResult, cleanResult, species, recordCount, hasGbifCredentials, climateSource, climateRes, onTabChange }: OverviewTabProps) {
  const [scenarios, setScenarios] = useState<ClimateScenario[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [boundaries, setBoundaries] = useState<BoundaryFile[]>([]);
  const [boundariesLoading, setBoundariesLoading] = useState(true);
  const [recentUploads, setRecentUploads] = useState<UploadFile[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [wcCheck, setWcCheck] = useState<{ available: number[]; missing: number[] } | null>(null);
  const [chelsaCheck, setChelsaCheck] = useState<{ available: number[]; missing: number[] } | null>(null);
  const [climateCheckLoading, setClimateCheckLoading] = useState(true);

  useEffect(() => {
    apiGet<{ scenarios: ClimateScenario[] }>("/api/v1/climate/scenarios")
      .then((d) => setScenarios(d.scenarios || []))
      .catch(() => {}).finally(() => setScenariosLoading(false));
    apiGet<{ boundaries: BoundaryFile[] }>("/api/v1/data/boundary/list")
      .then((d) => setBoundaries(d.boundaries || []))
      .catch(() => {}).finally(() => setBoundariesLoading(false));
    apiGet<{ uploads: UploadFile[] }>("/api/v1/data/occurrences/uploads?limit=3")
      .then((d) => setRecentUploads(d.uploads || []))
      .catch(() => {}).finally(() => setUploadsLoading(false));
    Promise.all([
      apiGet<{ available: number[]; missing: number[] }>(`/api/v1/climate/check?source=worldclim&res=${climateRes}&biovars=1,4,6,12,15,18`).catch(() => null),
      apiGet<{ available: number[]; missing: number[] }>("/api/v1/climate/check?source=chelsa&res=0.5&biovars=1,4,6,12,15,18").catch(() => null),
    ]).then(([wc, ch]) => {
      setWcCheck(wc);
      setChelsaCheck(ch);
      setClimateCheckLoading(false);
    });
  }, [climateRes]);

  const hasOccurrences = !!(uploadResult?.file_id || recordCount > 0 || recentUploads.length > 0);
  const isCleaned = !!cleanResult?.valid_records;
  const validRecordCount = (cleanResult?.valid_records as number) || recordCount || 0;
  const futureScenarios = scenarios.filter((s) => s.type === "future");
  const currentScenarios = scenarios.filter((s) => s.type === "current");
  const wcLayers = wcCheck?.available?.length || 0;
  const chelsaLayers = chelsaCheck?.available?.length || 0;
  const totalClimateLayers = wcLayers + chelsaLayers;

  const readinessItems = [
    { label: "Occurrence data loaded", ok: hasOccurrences, detail: hasOccurrences ? `${validRecordCount.toLocaleString()} records` : "Upload data in the Upload tab" },
    { label: "Data cleaned", ok: isCleaned, detail: isCleaned ? `${validRecordCount.toLocaleString()} valid records` : "Clean data before modeling" },
    { label: "Species selected", ok: !!species && species !== "Untitled species", detail: species || "Select a species on the Model page" },
    { label: "Climate layers ready", ok: totalClimateLayers > 0, detail: totalClimateLayers > 0 ? `${wcLayers} WorldClim + ${chelsaLayers} CHELSA layers` : "Download in Climate tab" },
    { label: "Boundary configured", ok: boundaries.length > 0, detail: boundaries.length > 0 ? `${boundaries.length} file(s)` : "Set up in Boundary tab" },
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
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-sdm-heading">Occurrence Data</h3>
          </div>
          <NavButton tab="upload" />
          {hasOccurrences ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-sdm-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Loaded
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-sdm-muted">
              <AlertTriangle className="h-3.5 w-3.5" /> None
            </span>
          )}
        </div>

        {/* Current session data */}
        {hasOccurrences && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3 pb-3 border-b border-sdm-border/50">
            <div><span className="text-sdm-muted">Records:</span> <span className="font-medium text-sdm-text">{validRecordCount.toLocaleString()}</span></div>
            <div><span className="text-sdm-muted">Species:</span> <span className="font-medium text-sdm-text">{species}</span></div>
            <div><span className="text-sdm-muted">Cleaned:</span> <span className={`font-medium ${isCleaned ? "text-sdm-success" : "text-sdm-warning"}`}>{isCleaned ? "Yes" : "No"}</span></div>
            <div><span className="text-sdm-muted">Source:</span> <span className="font-medium text-sdm-text">{(uploadResult?.source as string) || "Upload"}</span></div>
          </div>
        )}

        {/* Recent uploads */}
        {uploadsLoading ? (
          <div className="flex items-center gap-2 text-sm text-sdm-muted py-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading uploads...</div>
        ) : recentUploads.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-sdm-muted mb-1">Recent uploads</p>
            {recentUploads.map((u) => (
              <div key={u.file_id} className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate text-sdm-text">{u.file_name}</span>
                  <FormatBadge format={u.format} />
                  {u.species && <span className="text-xs text-sdm-muted truncate">{u.species}</span>}
                  {u.cleaned && <CheckCircle2 className="h-3 w-3 shrink-0 text-sdm-success" />}
                </div>
                <span className="text-sdm-muted shrink-0">{u.n_rows.toLocaleString()} rows</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-sdm-muted">No occurrence data loaded yet. Upload a CSV or search GBIF.</p>
        )}
      </div>

      {/* Climate Data */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Cloud className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-sdm-heading">Climate Data</h3>
          </div>
          <NavButton tab="climate" />
          {climateCheckLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sdm-muted" />
          ) : (
            <span className={`flex items-center gap-1.5 text-xs font-medium ${totalClimateLayers > 0 ? "text-sdm-success" : "text-sdm-muted"}`}>
              {totalClimateLayers > 0 ? `${totalClimateLayers} layers` : "None"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-sdm-muted">WorldClim BIO:</span>
            <p className="mt-0.5 font-medium text-sdm-text">{wcLayers > 0 ? `${wcLayers} of 6 available` : "Not downloaded"}</p>
          </div>
          <div>
            <span className="text-sdm-muted">CHELSA BIO:</span>
            <p className="mt-0.5 font-medium text-sdm-text">{chelsaLayers > 0 ? `${chelsaLayers} of 6 available` : "Not downloaded"}</p>
          </div>
          <div>
            <span className="text-sdm-muted">Future scenarios:</span>
            <p className="mt-0.5 font-medium text-sdm-text">{futureScenarios.length > 0 ? `${futureScenarios.length} downloaded` : "None"}</p>
          </div>
        </div>
      </div>

      {/* Covariates */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Mountain className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-sdm-heading">Covariates</h3>
          </div>
          <NavButton tab="covariates" />
          <span className="text-xs text-sdm-muted">Download per-layer</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {COVARIATE_TYPES.map((ct) => (
            <div key={ct.id} className="flex items-center gap-2 rounded-md border border-sdm-border/50 bg-sdm-surface-soft px-3 py-2 text-xs text-sdm-muted">
              <span className="text-sdm-accent shrink-0">{ct.icon}</span>
              {ct.label}
            </div>
          ))}
        </div>
      </div>

      {/* Boundaries */}
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sdm-surface-soft text-sdm-accent">
            <Map className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-sdm-heading">Boundaries</h3>
          </div>
          <NavButton tab="boundary" />
          {boundariesLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sdm-muted" />
          ) : (
            <span className={`flex items-center gap-1.5 text-xs font-medium ${boundaries.length > 0 ? "text-sdm-success" : "text-sdm-muted"}`}>
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
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-sdm-heading">Model Readiness</h3>
          </div>
          <a href="/model" className="flex h-7 w-7 items-center justify-center rounded-md text-sdm-accent hover:text-sdm-accent/80 transition-colors" title="Go to model">
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <div className="space-y-2">
          {readinessItems.map((item) => (
            <div key={item.label} className="flex items-center gap-3 text-sm">
              {item.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-sdm-success" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-sdm-warning" />}
              <span className="text-sdm-text">{item.label}</span>
              <span className="ml-auto text-xs text-sdm-muted">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
