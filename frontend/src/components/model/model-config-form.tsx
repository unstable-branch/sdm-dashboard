"use client";

import { useState, useEffect } from "react";
import { modelConfigSchema, type ModelConfig } from "@sdm/shared";
import { BIOVAR_CHOICES, EXTENT_PRESETS, MODEL_BACKENDS, DEFAULT_CONFIG, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES, buildFutureWorldclimPath } from "@sdm/shared";
import { SOIL_VARS, SOIL_DEPTHS, UV_VARS } from "@sdm/shared";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Info, CloudOff, Cloud } from "lucide-react";
import Link from "next/link";
import { useSDMStore } from "@/stores/sdm-store";

interface ModelInfo {
  id: string;
  label: string;
  maturity: string;
  min_records?: number | null;
  packages?: string[];
  notes?: string;
  available?: boolean;
}

interface ModelConfigFormProps {
  occurrenceFile: string | null;
  recordCount: number;
  cleanedOccurrence: {
    filePath: string;
    df: Record<string, unknown>[];
    sourceCounts: Record<string, number>;
    nAbsentExcluded: number;
    originalRows: number;
    validRecords: number;
  } | null;
  onSubmit: (config: Partial<ModelConfig>) => void;
  loading: boolean;
}

export function ModelConfigForm({ occurrenceFile, recordCount, cleanedOccurrence, onSubmit, loading }: ModelConfigFormProps) {
  const setSpeciesStore = useSDMStore((s) => s.setSpecies);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>(MODEL_BACKENDS);
  const [species, setSpecies] = useState(() => useSDMStore.getState().species || "Untitled species");
  const [speciesSuggestions, setSpeciesSuggestions] = useState<string[]>([]);
  const [speciesInputFocused, setSpeciesInputFocused] = useState(false);
  const [speciesSelectedIndex, setSpeciesSelectedIndex] = useState(-1);
  const [modelId, setModelId] = useState("glm");
  const [biovars, setBiovars] = useState<number[]>(DEFAULT_CONFIG.biovars);
  const [extentPreset, setExtentPreset] = useState("aus_full");
  const [customExtent, setCustomExtent] = useState<[number, number, number, number]>([112, 154, -44, -10]);
  const [maskType, setMaskType] = useState<"none" | "landmass" | "ocean">("none");
  const [maskBufferDeg, setMaskBufferDeg] = useState<number | undefined>(undefined);
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
  const [futureGcm, setFutureGcm] = useState("UKESM1-0-LL");
  const [futureSsp, setFutureSsp] = useState("SSP2-4.5");
  const [futurePeriod, setFuturePeriod] = useState("2041-2060");
  const [futureProjection2, setFutureProjection2] = useState(false);
  const [futureLabel2, setFutureLabel2] = useState("Future climate 2");
  const [futureGcm2, setFutureGcm2] = useState("MPI-ESM1-2-HR");
  const [futureSsp2, setFutureSsp2] = useState("SSP3-7.0");
  const [futurePeriod2, setFuturePeriod2] = useState("2061-2080");
  const [vifReduction, setVifReduction] = useState(false);
  const [climateMatching, setClimateMatching] = useState(false);
  const [maxnetFeatures, setMaxnetFeatures] = useState(DEFAULT_CONFIG.maxnetFeatures);
  const [maxnetRegmult, setMaxnetRegmult] = useState(DEFAULT_CONFIG.maxnetRegmult);
  const [error, setError] = useState<string | null>(null);

  const [multiEnsembleModels, setMultiEnsembleModels] = useState<string[]>(["glm", "gam", "maxnet", "rf"]);
  const [biomod2Models, setBiomod2Models] = useState<string[]>(["GLM", "GAM", "RF"]);
  const [esmNRuns, setEsmNRuns] = useState(5);
  const [esmSplit, setEsmSplit] = useState(70);

  const [elevationDemtype, setElevationDemtype] = useState(DEFAULT_CONFIG.elevationDemtype);
  const [vegProducts, setVegProducts] = useState(DEFAULT_CONFIG.vegProducts);
  const [vegProduct, setVegProduct] = useState(DEFAULT_CONFIG.vegProducts[0]);
  const [lulcYear, setLulcYear] = useState(DEFAULT_CONFIG.lulcYear);
  const [vifThreshold, setVifThreshold] = useState(DEFAULT_CONFIG.vifThreshold);
  const [targetGroupFile, setTargetGroupFile] = useState<File | null>(null);

  const [climateSource, setClimateSource] = useState<"worldclim" | "chelsa">("worldclim");
  const [climateRes, setClimateRes] = useState(10);
  const [missingBiovars, setMissingBiovars] = useState<number[]>([]);
  const [climateCheckLoading, setClimateCheckLoading] = useState(false);

  useEffect(() => {
    fetch("/api/v1/sdm/models")
      .then((res) => res.ok ? res.json() : null)
      .then((models) => {
        if (models && Array.isArray(models)) {
          const defaults = MODEL_BACKENDS.reduce<Record<string, { label: string; maturity: string; min_records: number | null; packages?: string[]; notes?: string; available?: boolean }>>((acc, m) => {
            acc[m.id] = {
              label: m.label,
              maturity: m.maturity,
              min_records: m.min_records ?? null,
              packages: (m as Record<string, unknown>).packages as string[] | undefined,
              notes: (m as Record<string, unknown>).notes as string | undefined,
              available: (m as Record<string, unknown>).available as boolean | undefined,
            };
            return acc;
          }, {});

          setAvailableModels(models.map((m: Record<string, unknown>) => {
            const id = m.id as string;
            const def = defaults[id];
            return {
              id,
              label: (m.label as string) || def?.label || id,
              maturity: (m.maturity as string) || def?.maturity || "experimental",
              min_records: (m.min_records as number) ?? def?.min_records ?? null,
              packages: (m.packages as string[]) || def?.packages || [],
              notes: (m.notes as string) || def?.notes || "",
              available: (m.available as boolean) ?? def?.available ?? true,
            };
          }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/v1/data/species?limit=100")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data && Array.isArray(data.species)) {
          setSpeciesSuggestions(data.species.map((s: Record<string, unknown>) => s.name as string));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (biovars.length < 2) return;
    const identifier = `${climateSource}_${climateRes}`;
    const timer = setTimeout(() => {
      setClimateCheckLoading(true);
      fetch(`/api/v1/climate/check?source=${climateSource}&res=${climateRes}&biovars=${biovars.join(",")}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data && Array.isArray(data.available)) {
            const availableSet = new Set(data.available as number[]);
            setMissingBiovars(biovars.filter((b) => !availableSet.has(b)));
          }
        })
        .catch(() => setMissingBiovars(biovars))
        .finally(() => setClimateCheckLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [biovars.join(","), climateSource, climateRes]);

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

  const toggleEnsembleModel = (m: string) => {
    setMultiEnsembleModels((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  };

  const toggleBiomod2Model = (a: string) => {
    setBiomod2Models((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const handleSubmit = () => {
    setError(null);

    const extent = extentPreset === "custom" ? customExtent : EXTENT_PRESETS[extentPreset]?.extent;
    if (!extent) {
      setError("Invalid extent preset");
      return;
    }

    const useCleaned = cleanedOccurrence && cleanedOccurrence.filePath;

    const config = {
      species,
      modelId,
      biovars,
      projectionExtent: extent,
      maskType,
      maskBufferDeg,
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
      futureWorldclimDir: futureProjection ? buildFutureWorldclimPath(futureGcm, futureSsp, futurePeriod) : undefined,
      futureLabel,
      futureProjection2: futureProjection && futureProjection2,
      futureWorldclimDir2: futureProjection && futureProjection2 ? buildFutureWorldclimPath(futureGcm2, futureSsp2, futurePeriod2) : undefined,
      futureLabel2: futureProjection2 ? futureLabel2 : undefined,
      vifReduction,
      vifThreshold: vifReduction ? vifThreshold : undefined,
      elevationDemtype: useElevation ? elevationDemtype : undefined,
      vegProducts: useVegetation ? [vegProduct] : undefined,
      lulcYear: useLulc ? lulcYear : undefined,
      biasMethod: biasMethod === "target_group" ? "uniform" : biasMethod,
      climateMatching,
      thinByCell,
      mergeSmallSources,
      minSourceRecords,
      thickeningDistanceKm,
      paReplicates,
      maxnetFeatures,
      maxnetRegmult,
      aggregationFactor,
      nCores,
      seed,
      occurrenceFile: useCleaned ? cleanedOccurrence!.filePath : (occurrenceFile || ""),
      cleanedFilePath: useCleaned ? cleanedOccurrence!.filePath : undefined,
      source: climateSource,
      worldclimRes: climateRes,
      multiEnsembleModels: modelId === "multi_ensemble" ? multiEnsembleModels : undefined,
      biomod2Models: modelId === "biomod2" ? biomod2Models : undefined,
      esmNRuns: isESM ? esmNRuns : undefined,
      esmSplit: isESM ? esmSplit : undefined,
    };

    const parsed = modelConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }

    onSubmit(config);
  };

  const selectedModel = availableModels.find((m) => m.id === modelId);
  const isESM = modelId.startsWith("esm_");
  const effectiveRecordCount = cleanedOccurrence
    ? cleanedOccurrence.validRecords
    : recordCount;
  const lowRecordWarning = selectedModel?.min_records && effectiveRecordCount !== null && effectiveRecordCount < selectedModel.min_records;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-300/30 bg-red-500/5 p-3 text-sm text-red-500">
          {error}
        </div>
      )}

      {cleanedOccurrence && cleanedOccurrence.filePath ? (
        <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-indigo-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-sdm-text">Cleaned occurrence data ready</p>
            <p className="text-xs text-sdm-muted">{cleanedOccurrence.originalRows.toLocaleString()} original → {cleanedOccurrence.validRecords.toLocaleString()} cleaned records</p>
          </div>
        </div>
      ) : occurrenceFile && (
        <div className="rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-sdm-text truncate">{typeof occurrenceFile === "string" ? occurrenceFile.split("/").pop() : String(occurrenceFile)}</p>
            <p className="text-xs text-sdm-muted truncate">{occurrenceFile}</p>
          </div>
        </div>
      )}

      {cleanedOccurrence && cleanedOccurrence.validRecords === 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-500">Cleaning produced 0 valid records</p>
            <p className="text-xs text-red-400">The occurrence data has no valid records after cleaning. The model run will likely fail. Go back to the Data page and check your data.</p>
          </div>
        </div>
      )}
      {!cleanedOccurrence && occurrenceFile && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-500">Cleaning recommended</p>
            <p className="text-xs text-amber-400">Clean your occurrence data on the <Link href="/data?tab=clean" className="underline">Data page</Link> before running the model. The model will clean inline if you proceed without previewing.</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Species & Model</h2>

        <div className="relative">
          <label className="block text-sm font-medium text-sdm-text mb-1">Species / model label</label>
          <input
            type="text"
            value={species}
            onChange={(e) => { setSpecies(e.target.value); setSpeciesStore(e.target.value); setSpeciesSelectedIndex(-1); }}
            onFocus={() => setSpeciesInputFocused(true)}
            onBlur={() => setTimeout(() => setSpeciesInputFocused(false), 200)}
            onKeyDown={(e) => {
              const filtered = speciesSuggestions
                .filter((s) => s.toLowerCase().includes(species.toLowerCase()) && s !== species)
                .slice(0, 10);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSpeciesSelectedIndex((prev) => (prev + 1) % filtered.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSpeciesSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
              } else if (e.key === "Enter" && speciesSelectedIndex >= 0 && speciesSelectedIndex < filtered.length) {
                e.preventDefault();
                setSpecies(filtered[speciesSelectedIndex]);
                setSpeciesStore(filtered[speciesSelectedIndex]);
                setSpeciesInputFocused(false);
              } else if (e.key === "Escape") {
                setSpeciesInputFocused(false);
              }
            }}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
            placeholder="Enter species name or select from history"
            role="combobox"
            aria-expanded={speciesInputFocused && speciesSuggestions.length > 0}
            aria-haspopup="listbox"
            aria-autocomplete="list"
          />
          {speciesInputFocused && speciesSuggestions.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border border-sdm-border bg-sdm-surface shadow-lg max-h-48 overflow-y-auto" role="listbox">
              {speciesSuggestions
                .filter((s) => s.toLowerCase().includes(species.toLowerCase()) && s !== species)
                .slice(0, 10)
                .map((s, idx) => (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={idx === speciesSelectedIndex}
                    onMouseDown={() => { setSpecies(s); setSpeciesStore(s); setSpeciesInputFocused(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft",
                      idx === speciesSelectedIndex && "bg-sdm-accent/10"
                    )}
                  >
                    {s}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Model backend</label>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id} disabled={m.available === false}>
                {m.label} ({m.maturity}){m.available === false ? " — unavailable" : ""}
              </option>
            ))}
          </select>
          {selectedModel?.maturity === "experimental" && (
            <p className="mt-1 text-xs text-sdm-warning">Experimental model — results may vary</p>
          )}
          {selectedModel?.available === false && selectedModel.notes && (
            <p className="mt-1 text-xs text-sdm-muted">{selectedModel.notes}</p>
          )}
          {isESM && (
            <div className="mt-2 rounded-md bg-blue-500/10 border border-blue-500/30 p-3 text-xs text-sdm-text">
              <p className="font-medium flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                Ensembles of Small Models (ESM)
              </p>
              <p className="mt-1 text-sdm-muted">
                Recommended for rare species with few occurrence records. Uses bivariate models weighted by AUC.
              </p>
            </div>
          )}
          {lowRecordWarning && (
            <div className="mt-2 rounded-md bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {selectedModel?.label} recommends ≥ {selectedModel.min_records} records. You have {effectiveRecordCount}.
                Results may be unreliable.
              </span>
            </div>
          )}
          {selectedModel?.notes && (
            <p className="mt-1 text-xs text-sdm-muted italic">{selectedModel.notes}</p>
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

        {modelId === "multi_ensemble" && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <p className="text-xs font-semibold text-sdm-heading uppercase tracking-wide">Ensemble models</p>
            <div className="flex flex-wrap gap-2">
              {["glm", "gam", "maxnet", "rf", "xgboost", "rangebag"].map((m) => (
                <label key={m} className="px-2 py-1 rounded text-xs cursor-pointer border border-sdm-border text-sdm-muted hover:border-sdm-accent/50 has-checked:border-sdm-accent has-checked:bg-sdm-accent/10 has-checked:text-sdm-accent">
                  <input type="checkbox" className="sr-only" checked={multiEnsembleModels.includes(m)} onChange={() => toggleEnsembleModel(m)} />
                  {m === "glm" ? "GLM" : m === "gam" ? "GAM" : m === "maxnet" ? "MaxNet" : m === "rf" ? "RF" : m === "xgboost" ? "XGBoost" : "Rangebag"}
                </label>
              ))}
            </div>
            <p className="text-xs text-sdm-muted">Select 2+ models for the ensemble. Availability depends on installed R packages.</p>
          </div>
        )}

        {modelId === "biomod2" && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <p className="text-xs font-semibold text-sdm-heading uppercase tracking-wide">biomod2 algorithms</p>
            <div className="flex flex-wrap gap-2">
              {["GLM", "GAM", "RF", "MARS", "FDA", "CTA", "ANN", "SRE"].map((a) => (
                <label key={a} className="px-2 py-1 rounded text-xs cursor-pointer border border-sdm-border text-sdm-muted hover:border-sdm-accent/50 has-checked:border-sdm-accent has-checked:bg-sdm-accent/10 has-checked:text-sdm-accent">
                  <input type="checkbox" className="sr-only" checked={biomod2Models.includes(a)} onChange={() => toggleBiomod2Model(a)} />
                  {a}
                </label>
              ))}
            </div>
            <p className="text-xs text-sdm-muted">Requires <code className="text-sdm-accent">options(sdm.enable_biomod2 = TRUE)</code> in R.</p>
          </div>
        )}

        {isESM && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <p className="text-xs font-semibold text-sdm-heading uppercase tracking-wide">ESM settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">Evaluation runs</label>
                <input type="number" value={esmNRuns} onChange={(e) => setEsmNRuns(Number(e.target.value))} min={2} max={100} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">Data split (%)</label>
                <input type="number" value={esmSplit} onChange={(e) => setEsmSplit(Number(e.target.value))} min={50} max={90} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Climate & BIO variables</h2>
        <p className="text-sm text-sdm-muted">Select at least 2 climate variables</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Climate source</label>
            <select
              value={climateSource}
              onChange={(e) => {
                const src = e.target.value as "worldclim" | "chelsa";
                setClimateSource(src);
                if (src === "chelsa") setClimateRes(0.5);
              }}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
            >
              <option value="worldclim">WorldClim v2.1</option>
              <option value="chelsa">CHELSA v2.1</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">Resolution</label>
            <select
              value={climateRes}
              onChange={(e) => setClimateRes(Number(e.target.value))}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
            >
              {climateSource === "worldclim" ? (
                <>
                  <option value={10}>10 arc-minutes (~20 km)</option>
                  <option value={5}>5 arc-minutes (~10 km)</option>
                  <option value={2.5}>2.5 arc-minutes (~5 km)</option>
                </>
              ) : (
                <option value={0.5}>30 arc-seconds (~1 km)</option>
              )}
            </select>
          </div>
        </div>

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

        {climateCheckLoading ? (
          <div className="flex items-center gap-2 text-xs text-sdm-muted">
            <span className="animate-pulse">Checking climate data availability...</span>
          </div>
        ) : missingBiovars.length > 0 && biovars.length >= 2 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
            <CloudOff className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-sdm-text">Climate data not available locally</p>
              <p className="text-xs text-sdm-muted mt-0.5">
                {missingBiovars.length} BIO {missingBiovars.length === 1 ? "variable is" : "variables are"} missing: BIO{missingBiovars.join(", BIO")}
              </p>
              <p className="text-xs text-sdm-muted mt-0.5">
                Download missing layers from the Data → Climate tab, or enable auto-download.
              </p>
            </div>
          </div>
        ) : biovars.length >= 2 ? (
          <div className="flex items-center gap-2 text-xs text-green-500">
            <Cloud className="h-3.5 w-3.5" />
            <span>All selected BIO variables available locally</span>
          </div>
        ) : null}
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
              <input type="number" min={-180} max={180} step={0.1} value={customExtent[0]} onChange={(e) => setCustomExtent([Number(e.target.value), customExtent[1], customExtent[2], customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">xmax</label>
              <input type="number" min={-180} max={180} step={0.1} value={customExtent[1]} onChange={(e) => setCustomExtent([customExtent[0], Number(e.target.value), customExtent[2], customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">ymin</label>
              <input type="number" min={-90} max={90} step={0.1} value={customExtent[2]} onChange={(e) => setCustomExtent([customExtent[0], customExtent[1], Number(e.target.value), customExtent[3]])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">ymax</label>
              <input type="number" min={-90} max={90} step={0.1} value={customExtent[3]} onChange={(e) => setCustomExtent([customExtent[0], customExtent[1], customExtent[2], Number(e.target.value)])} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
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

        <div className="pt-2 border-t border-sdm-border">
          <h3 className="text-sm font-semibold text-sdm-heading mb-2">Boundary masking</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">Mask type</label>
              <select
                value={maskType}
                onChange={(e) => setMaskType(e.target.value as "none" | "landmass" | "ocean")}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
              >
                <option value="none">None</option>
                <option value="landmass">Landmass (remove ocean)</option>
                <option value="ocean">Ocean (remove land)</option>
              </select>
            </div>
            {maskType !== "none" && (
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Buffer (decimal degrees, optional — auto = half cell)
                </label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.01}
                  placeholder="Auto"
                  value={maskBufferDeg ?? ""}
                  onChange={(e) => setMaskBufferDeg(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                />
                <p className="text-xs text-sdm-muted mt-1">
                  Uses Natural Earth 1:110m Admin 0 countries as the base boundary.
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Future climate projection</label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={futureProjection} onChange={(e) => setFutureProjection(e.target.checked)} />
            Project future scenario
          </label>
        </div>

        {futureProjection && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Scenario label</label>
              <input type="text" value={futureLabel} onChange={(e) => setFutureLabel(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
              <select value={futureGcm} onChange={(e) => setFutureGcm(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {GCM_CHOICES.map((gcm) => (
                  <option key={gcm.id} value={gcm.id}>{gcm.label} — {gcm.description}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">SSP scenario</label>
              <select value={futureSsp} onChange={(e) => setFutureSsp(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {SSP_CHOICES.map((ssp) => (
                  <option key={ssp.id} value={ssp.id}>{ssp.label} — {ssp.description}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Time period</label>
              <select value={futurePeriod} onChange={(e) => setFuturePeriod(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {TIME_PERIOD_CHOICES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-sdm-muted font-mono">
              Path: Worldclim_future/{futureGcm}_{futureSsp}_{futurePeriod}
            </p>
          </div>
        )}

        {futureProjection && (
          <div className="pt-2 border-t border-sdm-border/50">
            <label className="flex items-center gap-2 text-sm text-sdm-text">
              <input type="checkbox" checked={futureProjection2} onChange={(e) => setFutureProjection2(e.target.checked)} />
              Add second future scenario
            </label>
          </div>
        )}

        {futureProjection && futureProjection2 && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Scenario label</label>
              <input type="text" value={futureLabel2} onChange={(e) => setFutureLabel2(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">GCM</label>
              <select value={futureGcm2} onChange={(e) => setFutureGcm2(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {GCM_CHOICES.map((gcm) => (
                  <option key={gcm.id} value={gcm.id}>{gcm.label} — {gcm.description}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">SSP scenario</label>
              <select value={futureSsp2} onChange={(e) => setFutureSsp2(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {SSP_CHOICES.map((ssp) => (
                  <option key={ssp.id} value={ssp.id}>{ssp.label} — {ssp.description}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">Time period</label>
              <select value={futurePeriod2} onChange={(e) => setFuturePeriod2(e.target.value)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                {TIME_PERIOD_CHOICES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-sdm-muted font-mono">
              Path: Worldclim_future/{futureGcm2}_{futureSsp2}_{futurePeriod2}
            </p>
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
          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useElevation} onChange={(e) => setUseElevation(e.target.checked)} />
              Add elevation (OpenTopography)
            </label>
            {useElevation && (
              <select
                value={elevationDemtype}
                onChange={(e) => setElevationDemtype(e.target.value)}
                className="ml-2 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text"
              >
                {["COP90", "SRTMGL3", "AW3D30", "SRTMGL1"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>

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

          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useVegetation} onChange={(e) => setUseVegetation(e.target.checked)} />
              Add vegetation productivity
            </label>
            {useVegetation && (
              <select value={vegProduct} onChange={(e) => setVegProduct(e.target.value)} className="ml-2 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                {["ndvi_annual_mean", "evi_annual_mean", "fc_overall", "fpar_mean", "lai_mean", "gpp_mean", "ndvi_peak", "ndvi_min"].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useLulc} onChange={(e) => setUseLulc(e.target.checked)} />
              Add LULC (MODIS)
            </label>
            {useLulc && (
              <select value={lulcYear} onChange={(e) => setLulcYear(Number(e.target.value))} className="ml-2 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                {[2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>
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
          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={vifReduction} onChange={(e) => setVifReduction(e.target.checked)} />
              Drop collinear covariates (VIF reduction)
            </label>
            {vifReduction && (
              <div className="flex items-center gap-2 ml-4">
                <span className="text-xs text-sdm-muted">Threshold:</span>
                <input
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={vifThreshold}
                  onChange={(e) => setVifThreshold(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-xs text-sdm-muted font-mono">{vifThreshold}</span>
              </div>
            )}
          </div>
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
              <option value="target_group" disabled>Target-group (requires file upload)</option>
              <option value="thickened">Thickened</option>
            </select>
            {biasMethod === "target_group" && (
              <p className="mt-1 text-xs text-amber-500">Target-group bias requires uploading a background occurrence file. Not yet available — falling back to uniform.</p>
            )}
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
        disabled={loading || !(occurrenceFile || cleanedOccurrence?.filePath) || biovars.length < 2}
        className="w-full rounded-md bg-sdm-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Running..." : missingBiovars.length > 0 ? "Run SDM (may download climate data)" : "Run SDM"}
      </button>
    </div>
  );
}
