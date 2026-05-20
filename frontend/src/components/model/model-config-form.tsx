"use client";

import { useState, useEffect } from "react";
import { modelConfigSchema, type ModelConfig } from "@sdm/shared";
import { BIOVAR_CHOICES, EXTENT_PRESETS, MODEL_BACKENDS, DEFAULT_CONFIG } from "@sdm/shared";
import { SOIL_VARS, SOIL_DEPTHS, UV_VARS } from "@sdm/shared";
import { cn } from "@/lib/utils";

interface ModelConfigFormProps {
  occurrenceFile: string | null;
  onSubmit: (config: Partial<ModelConfig>) => void;
  loading: boolean;
}

export function ModelConfigForm({ occurrenceFile, onSubmit, loading }: ModelConfigFormProps) {
  const [species, setSpecies] = useState("Untitled species");
  const [modelId, setModelId] = useState("glm");
  const [biovars, setBiovars] = useState<number[]>(DEFAULT_CONFIG.biovars);
  const [extentPreset, setExtentPreset] = useState("aus_full");
  const [customExtent, setCustomExtent] = useState<[number, number, number, number]>([112, 154, -44, -10]);
  const [backgroundN, setBackgroundN] = useState(DEFAULT_CONFIG.backgroundN);
  const [cvFolds, setCvFolds] = useState(DEFAULT_CONFIG.cvFolds);
  const [cvStrategy, setCvStrategy] = useState<"random" | "spatial_blocks">(DEFAULT_CONFIG.cvStrategy);
  const [cvBlockSizeKm, setCvBlockSizeKm] = useState(50);
  const [threshold, setThreshold] = useState(DEFAULT_CONFIG.threshold);
  const [includeQuadratic, setIncludeQuadratic] = useState(true);
  const [nCores, setNCores] = useState(DEFAULT_CONFIG.nCores);
  const [seed, setSeed] = useState(DEFAULT_CONFIG.seed);
  const [aggregationFactor, setAggregationFactor] = useState(DEFAULT_CONFIG.aggregationFactor);
  const [paReplicates, setPaReplicates] = useState(DEFAULT_CONFIG.paReplicates);
  const [biasMethod, setBiasMethod] = useState<"uniform" | "target_group" | "thickened">(DEFAULT_CONFIG.biasMethod);
  const [thickeningDistanceKm, setThickeningDistanceKm] = useState(DEFAULT_CONFIG.thickeningDistanceKm);
  const [minSourceRecords, setMinSourceRecords] = useState(DEFAULT_CONFIG.minSourceRecords);
  const [mergeSmallSources, setMergeSmallSources] = useState(true);
  const [thinByCell, setThinByCell] = useState(true);
  const [useElevation, setUseElevation] = useState(false);
  const [useSoil, setUseSoil] = useState(false);
  const [soilVars, setSoilVars] = useState<string[]>(DEFAULT_CONFIG.soilVars);
  const [soilDepths, setSoilDepths] = useState<string[]>(DEFAULT_CONFIG.soilDepths);
  const [useUv, setUseUv] = useState(false);
  const [uvVars, setUvVars] = useState<string[]>(DEFAULT_CONFIG.uvVars);
  const [useVegetation, setUseVegetation] = useState(false);
  const [useLulc, setUseLulc] = useState(false);
  const [useHfp, setUseHfp] = useState(false);
  const [useBioclimSeason, setUseBioclimSeason] = useState(false);
  const [useDrought, setUseDrought] = useState(false);
  const [futureProjection, setFutureProjection] = useState(false);
  const [futureLabel, setFutureLabel] = useState("Future climate");
  const [vifReduction, setVifReduction] = useState(false);
  const [climateMatching, setClimateMatching] = useState(false);
  const [maxnetFeatures, setMaxnetFeatures] = useState(DEFAULT_CONFIG.maxnetFeatures);
  const [maxnetRegmult, setMaxnetRegmult] = useState(DEFAULT_CONFIG.maxnetRegmult);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleBiovar = (id: number) => {
    setBiovars((prev) => prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]);
  };

  const toggleSoilVar = (id: string) => {
    setSoilVars((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const toggleSoilDepth = (depth: string) => {
    setSoilDepths((prev) => prev.includes(depth) ? prev.filter((d) => d !== depth) : [...prev, depth]);
  };

  const toggleUvVar = (id: string) => {
    setUvVars((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const handleSubmit = () => {
    setError(null);

    const extent = extentPreset === "custom" ? customExtent : EXTENT_PRESETS[extentPreset]?.extent;
    if (!extent) {
      setError("Invalid extent preset");
      return;
    }

    const config = {
      species,
      modelId,
      biovars,
      projectionExtent: extent,
      backgroundN,
      cvFolds,
      cvStrategy,
      cvBlockSizeKm: cvStrategy === "spatial_blocks" ? cvBlockSizeKm : undefined,
      threshold,
      includeQuadratic,
      useElevation,
      useSoil,
      soilVars,
      soilDepths,
      useUv,
      uvVars,
      useVegetation,
      useLulc,
      useHfp,
      useBioclimSeason,
      useDrought,
      futureProjection,
      futureLabel,
      vifReduction,
      climateMatching,
      thinByCell,
      mergeSmallSources,
      minSourceRecords,
      biasMethod,
      thickeningDistanceKm,
      paReplicates,
      maxnetFeatures,
      maxnetRegmult,
      aggregationFactor,
      nCores,
      seed,
      occurrenceFile: occurrenceFile || "",
    };

    const parsed = modelConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    onSubmit(config);
  };

  const selectedModel = MODEL_BACKENDS.find((m) => m.id === modelId);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Species & Model</h2>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Species / model label</label>
          <input
            type="text"
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Model backend</label>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
          >
            {MODEL_BACKENDS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.maturity})
              </option>
            ))}
          </select>
          {selectedModel?.maturity === "experimental" && (
            <p className="mt-1 text-xs text-sdm-warning">Experimental model — results may vary</p>
          )}
        </div>

        {(modelId === "maxnet") && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">MaxEnt features</label>
              <select
                value={maxnetFeatures}
                onChange={(e) => setMaxnetFeatures(e.target.value as typeof maxnetFeatures)}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text"
              >
                <option value="l">Linear</option>
                <option value="lq">Linear + Quadratic</option>
                <option value="lqp">Linear + Quadratic + Product</option>
                <option value="lqh">Linear + Quadratic + Hinge</option>
                <option value="lqpht">All</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Regularization multiplier</label>
              <input
                type="number"
                value={maxnetRegmult}
                onChange={(e) => setMaxnetRegmult(Number(e.target.value))}
                min={0.1}
                max={10}
                step={0.1}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text"
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Climate & BIO variables</h2>
        <p className="text-sm text-sdm-muted">Select at least 2 climate variables</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {BIOVAR_CHOICES.map((bio) => (
            <label
              key={bio.id}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors",
                biovars.includes(bio.id)
                  ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                  : "border-sdm-border bg-sdm-surface-soft text-sdm-text hover:border-sdm-accent/50"
              )}
            >
              <input
                type="checkbox"
                checked={biovars.includes(bio.id)}
                onChange={() => toggleBiovar(bio.id)}
                className="sr-only"
              />
              <span className="font-medium">{bio.label}</span>
            </label>
          ))}
        </div>
        {biovars.length < 2 && (
          <p className="text-xs text-sdm-danger">Select at least 2 BIO variables</p>
        )}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Projection</h2>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Extent preset</label>
          <select
            value={extentPreset}
            onChange={(e) => setExtentPreset(e.target.value)}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
          >
            {Object.entries(EXTENT_PRESETS).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
            <option value="custom">Custom extent</option>
          </select>
        </div>

        {extentPreset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">xmin</label>
              <input type="number" value={customExtent[0]} onChange={(e) => setCustomExtent([Number(e.target.value), customExtent[1], customExtent[2], customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">xmax</label>
              <input type="number" value={customExtent[1]} onChange={(e) => setCustomExtent([customExtent[0], Number(e.target.value), customExtent[2], customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">ymin</label>
              <input type="number" value={customExtent[2]} onChange={(e) => setCustomExtent([customExtent[0], customExtent[1], Number(e.target.value), customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">ymax</label>
              <input type="number" value={customExtent[3]} onChange={(e) => setCustomExtent([customExtent[0], customExtent[1], customExtent[2], Number(e.target.value)])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">High-suitability threshold</label>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full"
          />
          <span className="text-sm text-sdm-muted">{threshold.toFixed(2)}</span>
        </div>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Future climate projection</label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={futureProjection} onChange={(e) => setFutureProjection(e.target.checked)} />
            Project future scenario
          </label>
        </div>

        {futureProjection && (
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Scenario label</label>
            <input type="text" value={futureLabel} onChange={(e) => setFutureLabel(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Model settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Background points</label>
            <input type="number" value={backgroundN} onChange={(e) => setBackgroundN(Number(e.target.value))} min={500} max={100000} step={500} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">CPU cores</label>
            <input type="number" value={nCores} onChange={(e) => setNCores(Number(e.target.value))} min={1} max={64} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Cross-validation folds</label>
            <select value={cvFolds} onChange={(e) => setCvFolds(Number(e.target.value))} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
              <option value={0}>Off</option>
              <option value={3}>3-fold</option>
              <option value={5}>5-fold</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">CV strategy</label>
            <select value={cvStrategy} onChange={(e) => setCvStrategy(e.target.value as typeof cvStrategy)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
              <option value="random">Random</option>
              <option value="spatial_blocks">Spatial blocks</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">PA replicates</label>
            <input type="number" value={paReplicates} onChange={(e) => setPaReplicates(Number(e.target.value))} min={1} max={10} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Raster aggregation</label>
            <input type="number" value={aggregationFactor} onChange={(e) => setAggregationFactor(Number(e.target.value))} min={1} max={8} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={includeQuadratic} onChange={(e) => setIncludeQuadratic(e.target.checked)} />
          Include quadratic climate responses
        </label>
      </div>

      <details className="rounded-lg border border-sdm-border bg-sdm-surface">
        <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-sdm-heading">Optional covariates</summary>
        <div className="px-6 pb-6 space-y-4">
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useElevation} onChange={(e) => setUseElevation(e.target.checked)} />
            Add elevation (OpenTopography)
          </label>

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useSoil} onChange={(e) => setUseSoil(e.target.checked)} />
            Add SoilGrids covariates
          </label>
          {useSoil && (
            <div className="space-y-2 ml-6">
              <div className="flex flex-wrap gap-2">
                {SOIL_VARS.map((v: { id: string; label: string }) => (
                  <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", soilVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" checked={soilVars.includes(v.id)} onChange={() => toggleSoilVar(v.id)} className="sr-only" />
                    {v.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {SOIL_DEPTHS.map((d: string) => (
                  <label key={d} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", soilDepths.includes(d) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" checked={soilDepths.includes(d)} onChange={() => toggleSoilDepth(d)} className="sr-only" />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useUv} onChange={(e) => setUseUv(e.target.checked)} />
            Add UV-B covariates (glUV)
          </label>
          {useUv && (
            <div className="flex flex-wrap gap-2 ml-6">
              {UV_VARS.map((v: { id: string; label: string }) => (
                <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", uvVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                  <input type="checkbox" checked={uvVars.includes(v.id)} onChange={() => toggleUvVar(v.id)} className="sr-only" />
                  {v.label}
                </label>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useVegetation} onChange={(e) => setUseVegetation(e.target.checked)} />
            Add vegetation productivity
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useLulc} onChange={(e) => setUseLulc(e.target.checked)} />
            Add LULC (MODIS)
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useHfp} onChange={(e) => setUseHfp(e.target.checked)} />
            Add Human Footprint
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useBioclimSeason} onChange={(e) => setUseBioclimSeason(e.target.checked)} />
            Add bioclimatic seasonality
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useDrought} onChange={(e) => setUseDrought(e.target.checked)} />
            Add drought index (scPDSI)
          </label>
        </div>
      </details>

      <details className="rounded-lg border border-sdm-border bg-sdm-surface">
        <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-sdm-heading">Advanced settings</summary>
        <div className="px-6 pb-6 space-y-4">
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={vifReduction} onChange={(e) => setVifReduction(e.target.checked)} />
            Drop collinear covariates (VIF reduction)
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={climateMatching} onChange={(e) => setClimateMatching(e.target.checked)} />
            Compute climate matching
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={thinByCell} onChange={(e) => setThinByCell(e.target.checked)} />
            Thin duplicate records in same climate cell
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={mergeSmallSources} onChange={(e) => setMergeSmallSources(e.target.checked)} />
            Merge small occurrence sources
          </label>

          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Background sampling bias correction</label>
            <select value={biasMethod} onChange={(e) => setBiasMethod(e.target.value as typeof biasMethod)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
              <option value="uniform">Uniform random</option>
              <option value="target_group">Target-group</option>
              <option value="thickened">Thickened</option>
            </select>
          </div>

          {biasMethod === "thickened" && (
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Kernel distance (km)</label>
              <input type="number" value={thickeningDistanceKm} onChange={(e) => setThickeningDistanceKm(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Merge sources with fewer than</label>
            <input type="number" value={minSourceRecords} onChange={(e) => setMinSourceRecords(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
        </div>
      </details>

      <button
        onClick={handleSubmit}
        disabled={loading || !occurrenceFile || biovars.length < 2}
        className="w-full rounded-md bg-sdm-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Running..." : "Run SDM"}
      </button>
    </div>
  );
}
