"use client";

import { GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES, buildFutureWorldclimPath } from "@sdm/shared";

interface ModelConfigFutureProps {
  futureProjection: boolean;
  onFutureProjectionChange: (val: boolean) => void;
  futureLabel: string;
  onFutureLabelChange: (val: string) => void;
  futureGcm: string;
  onFutureGcmChange: (val: string) => void;
  futureSsp: string;
  onFutureSspChange: (val: string) => void;
  futurePeriod: string;
  onFuturePeriodChange: (val: string) => void;
  futureProjection2: boolean;
  onFutureProjection2Change: (val: boolean) => void;
  futureLabel2: string;
  onFutureLabel2Change: (val: string) => void;
  futureGcm2: string;
  onFutureGcm2Change: (val: string) => void;
  futureSsp2: string;
  onFutureSsp2Change: (val: string) => void;
  futurePeriod2: string;
  onFuturePeriod2Change: (val: string) => void;
}

export function ModelConfigFuture({
  futureProjection,
  onFutureProjectionChange,
  futureLabel,
  onFutureLabelChange,
  futureGcm,
  onFutureGcmChange,
  futureSsp,
  onFutureSspChange,
  futurePeriod,
  onFuturePeriodChange,
  futureProjection2,
  onFutureProjection2Change,
  futureLabel2,
  onFutureLabel2Change,
  futureGcm2,
  onFutureGcm2Change,
  futureSsp2,
  onFutureSsp2Change,
  futurePeriod2,
  onFuturePeriod2Change,
}: ModelConfigFutureProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
      <h2 className="text-lg font-semibold text-sdm-heading">Future projection</h2>
      <div>
        <label className="block text-sm font-medium text-sdm-text mb-1">Future climate projection</label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={futureProjection} onChange={(e) => onFutureProjectionChange(e.target.checked)} />
          Project future scenario
        </label>
      </div>

      {futureProjection && (
        <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Scenario label</label>
            <input type="text" value={futureLabel} onChange={(e) => onFutureLabelChange(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
            <select value={futureGcm} onChange={(e) => onFutureGcmChange(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {GCM_CHOICES.map((gcm: { id: string; label: string; description: string }) => (
                <option key={gcm.id} value={gcm.id}>{gcm.label} — {gcm.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">SSP scenario</label>
            <select value={futureSsp} onChange={(e) => onFutureSspChange(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {SSP_CHOICES.map((ssp: { id: string; label: string; description: string }) => (
                <option key={ssp.id} value={ssp.id}>{ssp.label} — {ssp.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Time period</label>
            <select value={futurePeriod} onChange={(e) => onFuturePeriodChange(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {TIME_PERIOD_CHOICES.map((p: { id: string; label: string; description: string }) => (
                <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-sdm-muted font-mono">
            Path: Worldclim_future/{buildFutureWorldclimPath(futureGcm, futureSsp, futurePeriod)}
          </p>
        </div>
      )}

      {futureProjection && (
        <div className="pt-2 border-t border-sdm-border/50">
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={futureProjection2} onChange={(e) => onFutureProjection2Change(e.target.checked)} />
            Add second future scenario
          </label>
        </div>
      )}

      {futureProjection && futureProjection2 && (
        <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Scenario label</label>
            <input type="text" value={futureLabel2} onChange={(e) => onFutureLabel2Change(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
            <select value={futureGcm2} onChange={(e) => onFutureGcm2Change(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {GCM_CHOICES.map((gcm: { id: string; label: string; description: string }) => (
                <option key={gcm.id} value={gcm.id}>{gcm.label} — {gcm.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">SSP scenario</label>
            <select value={futureSsp2} onChange={(e) => onFutureSsp2Change(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {SSP_CHOICES.map((ssp: { id: string; label: string; description: string }) => (
                <option key={ssp.id} value={ssp.id}>{ssp.label} — {ssp.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Time period</label>
            <select value={futurePeriod2} onChange={(e) => onFuturePeriod2Change(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              {TIME_PERIOD_CHOICES.map((p: { id: string; label: string; description: string }) => (
                <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-sdm-muted font-mono">
            Path: Worldclim_future/{buildFutureWorldclimPath(futureGcm2, futureSsp2, futurePeriod2)}
          </p>
        </div>
      )}
    </div>
  );
}
