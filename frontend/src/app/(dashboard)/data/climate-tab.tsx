"use client";

import { DownloadProgress } from "@/components/climate/download-progress";
import { ScenarioList } from "@/components/climate/scenario-list";
import { Loader2, Download } from "lucide-react";
import { BIOVAR_CHOICES, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";

interface ClimateTabProps {
  climateSource: string;
  climateRes: number;
  climateBiovars: number[];
  availableBiovars: Set<number>;
  climateDownloadJob: string | null;
  cmip6Gcm: string;
  cmip6Ssp: string;
  cmip6Period: string;
  cmip6DownloadJob: string | null;
  avgGcms: string[];
  avgDownloadJob: string | null;
  climateError: string | null;
  scenarios: Array<Record<string, unknown>>;
  scenariosLoading: boolean;
  onSetClimateSource: (v: "worldclim" | "chelsa") => void;
  onSetClimateRes: (v: number) => void;
  onToggleClimateBiovar: (id: number) => void;
  onClimateDownload: () => void;
  onSetCmip6Gcm: (v: string) => void;
  onSetCmip6Ssp: (v: string) => void;
  onSetCmip6Period: (v: string) => void;
  onCmip6Download: () => void;
  onToggleAvgGcm: (id: string) => void;
  onAvgDownload: () => void;
  onDownloadComplete: (jobId: string) => void;
  onDownloadFailed: (jobId: string) => void;
  onCancelDownload: () => void;
  onFetchScenarios: () => void;
  onDeleteScenario: (id: string) => void;
}

export function ClimateTab({
  climateSource, climateRes, climateBiovars, availableBiovars,
  climateDownloadJob, cmip6Gcm, cmip6Ssp, cmip6Period, cmip6DownloadJob,
  avgGcms, avgDownloadJob, climateError,
  scenarios, scenariosLoading,
  onSetClimateSource, onSetClimateRes, onToggleClimateBiovar, onClimateDownload,
  onSetCmip6Gcm, onSetCmip6Ssp, onSetCmip6Period, onCmip6Download,
  onToggleAvgGcm, onAvgDownload,
  onDownloadComplete, onDownloadFailed, onCancelDownload, onFetchScenarios, onDeleteScenario,
}: ClimateTabProps) {
  const missingCount = climateBiovars.filter(b => !availableBiovars.has(b)).length;
  const allPresent = missingCount === 0 && climateBiovars.length > 0;
  const activeJob = climateDownloadJob || cmip6DownloadJob || avgDownloadJob;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-sdm-heading mb-1">Current climate</h2>
          <p className="text-sm text-sdm-muted mb-4">Download WorldClim v2.1 or CHELSA v2.1 BIO layers.</p>
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-sdm-text">
                <input type="radio" checked={climateSource === "worldclim"} onChange={() => { onSetClimateSource("worldclim"); onSetClimateRes(10); }} />
                WorldClim v2.1
              </label>
              <label className="flex items-center gap-2 text-sm text-sdm-text">
                <input type="radio" checked={climateSource === "chelsa"} onChange={() => { onSetClimateSource("chelsa"); onSetClimateRes(0.5); }} />
                CHELSA v2.1
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Resolution</label>
              <select value={climateRes} onChange={(e) => onSetClimateRes(Number(e.target.value))} className="rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                {climateSource === "worldclim" ? (
                  <><option value={2.5}>2.5 arc-min (~5 km)</option><option value={5}>5 arc-min (~10 km)</option><option value={10}>10 arc-min (~20 km)</option></>
                ) : <option value={0.5}>30 arc-seconds (~1 km)</option>}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">BIO variables</label>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-10 gap-1.5">
                {BIOVAR_CHOICES.map((bio) => {
                  const isAvailable = availableBiovars.has(bio.id);
                  return (
                    <label key={bio.id} className={`flex items-center justify-center rounded border px-2 py-1.5 text-xs cursor-pointer transition-colors relative ${
                      climateBiovars.includes(bio.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border bg-sdm-surface-soft text-sdm-muted hover:border-sdm-accent/50"}`}>
                      {isAvailable && <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-sdm-success translate-x-1/3 -translate-y-1/3" />}
                      <input type="checkbox" checked={climateBiovars.includes(bio.id)} onChange={() => onToggleClimateBiovar(bio.id)} className="sr-only" />
                      {bio.label}
                    </label>
                  );
                })}
              </div>
              {climateBiovars.length < 2 && <p className="text-xs text-sdm-danger mt-1">Select at least 2 BIO variables</p>}
            </div>

            <button onClick={onClimateDownload}
              disabled={climateDownloadJob !== null || climateBiovars.length < 2 || allPresent}
              className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {climateDownloadJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {climateDownloadJob ? "Downloading..." : allPresent ? "All layers present" : `Download ${missingCount} missing`}
            </button>
          </div>
        </div>

        <div className="border-t border-sdm-border pt-6">
          <h2 className="text-lg font-semibold text-sdm-heading mb-1">Future climate (CMIP6)</h2>
          <p className="text-sm text-sdm-muted mb-4">Download CMIP6 climate projections for future scenario analysis.</p>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
                <select value={cmip6Gcm} onChange={(e) => onSetCmip6Gcm(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                  {GCM_CHOICES.map((gcm) => <option key={gcm.id} value={gcm.id}>{gcm.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">SSP</label>
                <select value={cmip6Ssp} onChange={(e) => onSetCmip6Ssp(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                  {SSP_CHOICES.map((ssp) => <option key={ssp.id} value={ssp.id}>{ssp.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">Period</label>
                <select value={cmip6Period} onChange={(e) => onSetCmip6Period(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
                  {TIME_PERIOD_CHOICES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <button onClick={onCmip6Download} disabled={cmip6DownloadJob !== null}
              className="inline-flex items-center gap-2 rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
              {cmip6DownloadJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {cmip6DownloadJob ? "Downloading..." : "Download scenario"}
            </button>

            <div className="border-t border-sdm-border pt-4 mt-4">
              <h3 className="text-sm font-medium text-sdm-heading mb-2">Multi-GCM averaging</h3>
              <p className="text-xs text-sdm-muted mb-2">Select at least 2 GCMs to compute ensemble mean.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {GCM_CHOICES.map((gcm) => (
                  <label key={gcm.id} className={`px-2 py-1 rounded text-xs cursor-pointer border ${
                    avgGcms.includes(gcm.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted"}`}>
                    <input type="checkbox" checked={avgGcms.includes(gcm.id)} onChange={() => onToggleAvgGcm(gcm.id)} className="sr-only" />
                    {gcm.label}
                  </label>
                ))}
              </div>
              <button onClick={onAvgDownload} disabled={avgDownloadJob !== null || avgGcms.length < 2}
                className="inline-flex items-center gap-2 rounded-md bg-sdm-surface-soft border border-sdm-border px-4 py-2 text-sm font-medium text-sdm-text transition-colors hover:bg-sdm-surface disabled:opacity-50 disabled:cursor-not-allowed">
                {avgDownloadJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {avgDownloadJob ? "Averaging..." : "Average GCMs"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {climateError && (
        <div className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">{climateError}</div>
      )}
      {activeJob && (
        <DownloadProgress jobId={activeJob} onComplete={() => onDownloadComplete(activeJob)} onFailed={() => onDownloadFailed(activeJob)} onCancel={onCancelDownload} />
      )}
      <ScenarioList scenarios={scenarios as any} onRefresh={onFetchScenarios} onDelete={onDeleteScenario} loading={scenariosLoading} />
    </div>
  );
}
