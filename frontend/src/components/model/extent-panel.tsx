"use client";

import { EXTENT_PRESETS, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES } from "@sdm/shared";

interface ExtentPanelProps {
  extentPreset: string;
  customExtent: [number, number, number, number];
  threshold: number;
  futureProjection: boolean;
  futureLabel: string;
  futureGcm: string;
  futureSsp: string;
  futurePeriod: string;
  future2Enabled: boolean;
  future2Label: string;
  future2Gcm: string;
  future2Ssp: string;
  future2Period: string;
  extrapolationMask: boolean;
  climateSource: string;
  onSetExtentPreset: (v: string) => void;
  onSetCustomExtent: (v: [number, number, number, number]) => void;
  onSetThreshold: (v: number) => void;
  onSetFutureProjection: (v: boolean) => void;
  onSetFutureLabel: (v: string) => void;
  onSetFutureGcm: (v: string) => void;
  onSetFutureSsp: (v: string) => void;
  onSetFuturePeriod: (v: string) => void;
  onSetFuture2Enabled: (v: boolean) => void;
  onSetFuture2Label: (v: string) => void;
  onSetFuture2Gcm: (v: string) => void;
  onSetFuture2Ssp: (v: string) => void;
  onSetFuture2Period: (v: string) => void;
  onSetExtrapolationMask: (v: boolean) => void;
}

export function ExtentPanel({
  extentPreset, customExtent, threshold,
  futureProjection, futureLabel, futureGcm, futureSsp, futurePeriod,
  future2Enabled, future2Label, future2Gcm, future2Ssp, future2Period,
  extrapolationMask, climateSource,
  onSetExtentPreset, onSetCustomExtent, onSetThreshold,
  onSetFutureProjection, onSetFutureLabel, onSetFutureGcm, onSetFutureSsp, onSetFuturePeriod,
  onSetFuture2Enabled, onSetFuture2Label, onSetFuture2Gcm, onSetFuture2Ssp, onSetFuture2Period,
  onSetExtrapolationMask,
}: ExtentPanelProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
      <h2 className="text-lg font-semibold text-sdm-heading">Projection</h2>

      <div>
        <label className="block text-sm font-medium text-sdm-text mb-1">Extent preset</label>
        <select value={extentPreset} onChange={(e) => onSetExtentPreset(e.target.value)}
          className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none">
          {Object.entries(EXTENT_PRESETS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
          <option value="custom">Custom extent</option>
        </select>
      </div>

      {extentPreset === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          {(["xmin", "xmax", "ymin", "ymax"] as const).map((label, i) => (
            <div key={label}>
              <label className="block text-xs font-medium text-sdm-muted mb-1">{label}</label>
              <input type="number" value={customExtent[i]}
                onChange={(e) => { const n = [...customExtent]; n[i] = Number(e.target.value); onSetCustomExtent(n as [number,number,number,number]); }}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-sdm-text mb-1">High-suitability threshold</label>
        <input type="range" min={0.05} max={0.95} step={0.05} value={threshold} onChange={(e) => onSetThreshold(Number(e.target.value))} className="w-full" />
        <span className="text-sm text-sdm-muted">{threshold.toFixed(2)}</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-sdm-text mb-1">Future climate projection</label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={futureProjection} onChange={(e) => onSetFutureProjection(e.target.checked)} />
          Project future scenario
        </label>
      </div>

      {futureProjection && (
        <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
          {climateSource === "chelsa" && (
            <p className="text-xs text-sdm-warning">Future projection uses WorldClim CMIP6 data regardless of current climate source.</p>
          )}
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Scenario label</label>
            <input type="text" value={futureLabel} onChange={(e) => onSetFutureLabel(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
            <select value={futureGcm} onChange={(e) => onSetFutureGcm(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {GCM_CHOICES.map((gcm) => <option key={gcm.id} value={gcm.id}>{gcm.label} — {gcm.description}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">SSP scenario</label>
            <select value={futureSsp} onChange={(e) => onSetFutureSsp(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {SSP_CHOICES.map((ssp) => <option key={ssp.id} value={ssp.id}>{ssp.label} — {ssp.description}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Time period</label>
            <select value={futurePeriod} onChange={(e) => onSetFuturePeriod(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {TIME_PERIOD_CHOICES.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.description}</option>)}
            </select>
          </div>
          <p className="text-xs text-sdm-muted font-mono">Path: Worldclim_future/{futureGcm}_{futureSsp}_{futurePeriod}</p>

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={future2Enabled} onChange={(e) => onSetFuture2Enabled(e.target.checked)} />
            Compare second scenario
          </label>
          {future2Enabled && (
            <div className="space-y-3 ml-4 border-l-2 border-sdm-border/50 pl-3">
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">Label</label>
                <input type="text" value={future2Label} onChange={(e) => onSetFuture2Label(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
                <select value={future2Gcm} onChange={(e) => onSetFuture2Gcm(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                  {GCM_CHOICES.map((gcm) => <option key={gcm.id} value={gcm.id}>{gcm.label} — {gcm.description}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">SSP</label>
                <select value={future2Ssp} onChange={(e) => onSetFuture2Ssp(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                  {SSP_CHOICES.map((ssp) => <option key={ssp.id} value={ssp.id}>{ssp.label} — {ssp.description}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-sdm-text mb-1">Period</label>
                <select value={future2Period} onChange={(e) => onSetFuture2Period(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                  {TIME_PERIOD_CHOICES.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.description}</option>)}
                </select>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={extrapolationMask} onChange={(e) => onSetExtrapolationMask(e.target.checked)} />
            Mask extrapolation zones (MESS &lt; 0)
          </label>
          <p className="text-xs text-sdm-muted -mt-2">Cells where future climate is outside training range will be masked as unsuitable</p>
        </div>
      )}
    </div>
  );
}
