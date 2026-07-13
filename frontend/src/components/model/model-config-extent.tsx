"use client";

import { EXTENT_PRESETS, ANALYSIS_CRS_CHOICES } from "@sdm/shared";
import { TooltipInfo } from "@/components/ui/tooltip";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface ModelConfigExtentProps {
  extentPreset: string;
  onExtentPresetChange: (preset: string) => void;
  customExtent: [number, number, number, number];
  onCustomExtentChange: (extent: [number, number, number, number]) => void;
  separateTrainingExtent: boolean;
  onSeparateTrainingExtentChange: (val: boolean) => void;
  trainingExtentPreset: string;
  onTrainingExtentPresetChange: (preset: string) => void;
  trainingCustomExtent: [number, number, number, number];
  onTrainingCustomExtentChange: (extent: [number, number, number, number]) => void;
  boundary: "none" | "admin0" | "land" | "custom";
  onBoundaryChange: (boundary: "none" | "admin0" | "land" | "custom") => void;
  invertMask: boolean;
  onInvertMaskChange: (val: boolean) => void;
  maskBufferDeg: number | undefined;
  onMaskBufferDegChange: (val: number | undefined) => void;
  maskResolution: "auto" | "10m" | "50m" | "110m";
  onMaskResolutionChange: (val: "auto" | "10m" | "50m" | "110m") => void;
  maskCountry: string;
  onMaskCountryChange: (val: string) => void;
  countryOptions: string[];
  countriesLoading: boolean;
  customBoundaries: Array<{ file_path: string; file_name: string }>;
  autoExtentFromBoundary: boolean;
  onAutoExtentFromBoundaryChange: (val: boolean) => void;
  restrictBackground: boolean;
  onRestrictBackgroundChange: (val: boolean) => void;
  analysisCrs: string;
  onAnalysisCrsChange: (crs: string) => void;
}

export function ModelConfigExtent({
  extentPreset,
  onExtentPresetChange,
  customExtent,
  onCustomExtentChange,
  separateTrainingExtent,
  onSeparateTrainingExtentChange,
  trainingExtentPreset,
  onTrainingExtentPresetChange,
  trainingCustomExtent,
  onTrainingCustomExtentChange,
  boundary,
  onBoundaryChange,
  invertMask,
  onInvertMaskChange,
  maskBufferDeg,
  onMaskBufferDegChange,
  maskResolution,
  onMaskResolutionChange,
  maskCountry,
  onMaskCountryChange,
  countryOptions,
  countriesLoading,
  customBoundaries,
  autoExtentFromBoundary,
  onAutoExtentFromBoundaryChange,
  restrictBackground,
  onRestrictBackgroundChange,
  analysisCrs,
  onAnalysisCrsChange,
}: ModelConfigExtentProps) {
  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
      <h2 className="text-lg font-semibold text-sdm-heading">Projection Extent &amp; Threshold</h2>

      <div>
        <label className="block text-sm font-medium text-sdm-text mb-1">Projection extent (prediction area)</label>
        <select
          value={extentPreset}
          onChange={(e) => onExtentPresetChange(e.target.value)}
          className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
        >
          {Object.entries(EXTENT_PRESETS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>

      {extentPreset === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">xmin</label>
            <input type="number" min={-180} max={180} step={0.1} value={customExtent[0]} onChange={(e) => onCustomExtentChange([Number(e.target.value), customExtent[1], customExtent[2], customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">xmax</label>
            <input type="number" min={-180} max={180} step={0.1} value={customExtent[1]} onChange={(e) => onCustomExtentChange([customExtent[0], Number(e.target.value), customExtent[2], customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">ymin</label>
            <input type="number" min={-90} max={90} step={0.1} value={customExtent[2]} onChange={(e) => onCustomExtentChange([customExtent[0], customExtent[1], Number(e.target.value), customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">ymax</label>
            <input type="number" min={-90} max={90} step={0.1} value={customExtent[3]} onChange={(e) => onCustomExtentChange([customExtent[0], customExtent[1], customExtent[2], Number(e.target.value)])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="separate-training-extent"
          checked={separateTrainingExtent}
          onChange={(e) => onSeparateTrainingExtentChange(e.target.checked)}
          className="h-4 w-4 rounded border-sdm-border text-sdm-accent focus:ring-sdm-accent"
        />
        <label htmlFor="separate-training-extent" className="text-sm font-medium text-sdm-text">
          Use separate training extent
          <TooltipInfo content="Train model on one region (e.g. South America) and project to another (e.g. Australia). Useful for biosecurity risk assessments." />
        </label>
      </div>

      {separateTrainingExtent && (
        <>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Training extent (model fitting area)</label>
            <select
              value={trainingExtentPreset}
              onChange={(e) => onTrainingExtentPresetChange(e.target.value)}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
            >
              <option value="auto">Auto (occurrence bounding box)</option>
              {Object.entries(EXTENT_PRESETS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>

          {trainingExtentPreset === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">xmin</label>
                <input type="number" min={-180} max={180} step={0.1} value={trainingCustomExtent[0]} onChange={(e) => onTrainingCustomExtentChange([Number(e.target.value), trainingCustomExtent[1], trainingCustomExtent[2], trainingCustomExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">xmax</label>
                <input type="number" min={-180} max={180} step={0.1} value={trainingCustomExtent[1]} onChange={(e) => onTrainingCustomExtentChange([trainingCustomExtent[0], Number(e.target.value), trainingCustomExtent[2], trainingCustomExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">ymin</label>
                <input type="number" min={-90} max={90} step={0.1} value={trainingCustomExtent[2]} onChange={(e) => onTrainingCustomExtentChange([trainingCustomExtent[0], trainingCustomExtent[1], Number(e.target.value), trainingCustomExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">ymax</label>
                <input type="number" min={-90} max={90} step={0.1} value={trainingCustomExtent[3]} onChange={(e) => onTrainingCustomExtentChange([trainingCustomExtent[0], trainingCustomExtent[1], trainingCustomExtent[2], Number(e.target.value)])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
              </div>
            </div>
          )}
        </>
      )}

      {/* Boundary */}
      <div className="border-t border-sdm-border pt-4">
        <h3 className="text-sm font-semibold text-sdm-heading mb-2">Boundary</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Boundary
                <TooltipInfo content="Clips the suitability raster to landmass, ocean, or a custom boundary file." />
              </label>
              <select
                value={boundary}
                onChange={(e) => onBoundaryChange(e.target.value as "none" | "admin0" | "land" | "custom")}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
              >
                <option value="none">None</option>
                <option value="admin0">Admin 0 Countries</option>
                <option value="land">Coastline (land)</option>
                <option value="custom">Custom upload</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Buffer (deg, optional)
                <TooltipInfo content="Extends or shrinks boundary. Auto = half cell width." />
              </label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.01}
                placeholder="Auto"
                value={maskBufferDeg ?? ""}
                onChange={(e) => onMaskBufferDegChange(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
              />
            </div>
          </div>

          {boundary !== "none" && (
            <div className="space-y-3 border-t border-sdm-border pt-3">
              {boundary !== "custom" && (
                <div>
                  <label className="block text-xs font-medium text-sdm-muted mb-1">Resolution</label>
                  <select
                    value={maskResolution}
                    onChange={(e) => onMaskResolutionChange(e.target.value as "auto" | "10m" | "50m" | "110m")}
                    className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                  >
                    <option value="auto">Auto (match covariates)</option>
                    <option value="110m">1:110m (~18 km)</option>
                    <option value="50m">1:50m (~9 km)</option>
                    <option value="10m">1:10m (~1.8 km)</option>
                  </select>
                </div>
              )}

              {boundary === "admin0" && (
                <div>
                  <label className="block text-xs font-medium text-sdm-muted mb-1">Country</label>
                  <SearchableSelect
                    options={countryOptions}
                    value={maskCountry}
                    onChange={onMaskCountryChange}
                    placeholder="Search countries..."
                    loading={countriesLoading}
                    allLabel="All countries"
                  />
                </div>
              )}

              {boundary === "custom" && (
                <div>
                  <label className="block text-xs font-medium text-sdm-muted mb-1">Uploaded boundary file</label>
                  <select
                    value={maskCountry}
                    onChange={(e) => onMaskCountryChange(e.target.value)}
                    className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                  >
                    <option value="">Select a boundary...</option>
                    {customBoundaries.map((b) => (
                      <option key={b.file_path} value={b.file_path}>{b.file_name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-sdm-muted">
                    Upload custom GeoJSON on the{" "}
                    <a href="/data?tab=boundary" className="text-sdm-accent hover:underline">Boundary</a>{" "}
                    data page.
                  </p>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-sdm-muted cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={invertMask}
                  onChange={(e) => onInvertMaskChange(e.target.checked)}
                  className="rounded border-sdm-border bg-sdm-surface-soft"
                />
                Invert: keep ocean instead of land
              </label>
              <label className="flex items-center gap-2 text-xs text-sdm-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExtentFromBoundary}
                  onChange={(e) => onAutoExtentFromBoundaryChange(e.target.checked)}
                  className="rounded border-sdm-border bg-sdm-surface-soft"
                />
                Auto-set projection extent from boundary (+2&deg; margin)
              </label>
              <label className="flex items-center gap-2 text-xs text-sdm-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={restrictBackground}
                  onChange={(e) => onRestrictBackgroundChange(e.target.checked)}
                  className="rounded border-sdm-border bg-sdm-surface-soft"
                />
                Restrict background points to boundary (model trains only within boundary area)
              </label>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-sdm-text mb-1">
          Analysis CRS
          <TooltipInfo content="Projection for area calculations (EOO/AOO) and distance metrics. Auto-detect UTM is usually best." />
        </label>
        <select
          value={analysisCrs}
          onChange={(e) => onAnalysisCrsChange(e.target.value)}
          className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
        >
          {ANALYSIS_CRS_CHOICES.map((crs: { id: string; label: string; description: string }) => (
            <option key={crs.id} value={crs.id} title={crs.description}>{crs.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
