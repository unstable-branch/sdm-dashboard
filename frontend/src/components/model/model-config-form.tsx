"use client";

import { useState, useEffect, useDeferredValue, useMemo } from "react";
import { modelConfigSchema, type ModelConfig } from "@sdm/shared";
import { EXTENT_PRESETS, MODEL_BACKENDS, DEFAULT_CONFIG, buildFutureWorldclimPath } from "@sdm/shared";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import Link from "next/link";
import { useSDMStore } from "@/stores/sdm-store";
import { useSettingsStore } from "@/stores/settings-store";
import { apiGet } from "@/services/api";
import { ModelSelector } from "./model-selector";
import { SpeciesInput } from "./species-input";
import { ModelParamPanel } from "./model-param-panel";
import { ClimatePanel } from "./climate-panel";
import { ExtentPanel } from "./extent-panel";
import { ModelSettings } from "./model-settings";
import { CovariatePanel } from "./covariate-panel";
import { AdvancedSettings } from "./advanced-settings";

interface ModelInfo {
  id: string; label: string; maturity: string;
  min_records?: number | null; packages?: string[]; notes?: string; available?: boolean;
}

interface ModelConfigFormProps {
  occurrenceFile: string | null;
  recordCount: number;
  cleanedOccurrence: { filePath: string; df: Record<string, unknown>[]; sourceCounts: Record<string, number>; nAbsentExcluded: number; originalRows: number; validRecords: number; } | null;
  onSubmit: (config: Partial<ModelConfig>) => void;
  loading: boolean;
}

export default function ModelConfigForm({ occurrenceFile, recordCount, cleanedOccurrence, onSubmit, loading }: ModelConfigFormProps) {
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
  const [backgroundN, setBackgroundN] = useState(3000);
  const [cvFolds, setCvFolds] = useState(DEFAULT_CONFIG.cvFolds);
  const [cvStrategy, setCvStrategy] = useState<"random" | "spatial_blocks">("spatial_blocks");
  const [cvBlockSizeKm, _setCvBlockSizeKm] = useState(50);
  const [threshold, setThreshold] = useState(DEFAULT_CONFIG.threshold);
  const [includeQuadratic, setIncludeQuadratic] = useState(true);
  const [nCores, setNCores] = useState(DEFAULT_CONFIG.nCores);

  const seed = DEFAULT_CONFIG.seed;
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
  const [future2Enabled, setFuture2Enabled] = useState(false);
  const [future2Label, setFuture2Label] = useState("Future climate 2");
  const [future2Gcm, setFuture2Gcm] = useState("MPI-ESM1-2-HR");
  const [future2Ssp, setFuture2Ssp] = useState("SSP3-7.0");
  const [future2Period, setFuture2Period] = useState("2041-2060");
  const [extrapolationMask, setExtrapolationMask] = useState(true);
  const [vifReduction, setVifReduction] = useState(false);
  const [climateMatching, setClimateMatching] = useState(false);
  const [maxnetFeatures, setMaxnetFeatures] = useState(DEFAULT_CONFIG.maxnetFeatures);
  const [maxnetRegmult, setMaxnetRegmult] = useState(DEFAULT_CONFIG.maxnetRegmult);
  const [dnnArchitecture, setDnnArchitecture] = useState(DEFAULT_CONFIG.dnnArchitecture);
  const [dnnNSeeds, setDnnNSeeds] = useState(DEFAULT_CONFIG.dnnNSeeds);
  const [dnnDevice, setDnnDevice] = useState(DEFAULT_CONFIG.dnnDevice);
  const [brtNTrees, setBrtNTrees] = useState(DEFAULT_CONFIG.brtNTrees);
  const [brtInteractionDepth, setBrtInteractionDepth] = useState(DEFAULT_CONFIG.brtInteractionDepth);
  const [brtShrinkage, setBrtShrinkage] = useState(DEFAULT_CONFIG.brtShrinkage);
  const [brtBagFraction, setBrtBagFraction] = useState(DEFAULT_CONFIG.brtBagFraction);
  const [ctaCp, setCtaCp] = useState(DEFAULT_CONFIG.ctaCp);
  const [ctaMaxdepth, setCtaMaxdepth] = useState(DEFAULT_CONFIG.ctaMaxdepth);
  const [ctaMinsplit, setCtaMinsplit] = useState(DEFAULT_CONFIG.ctaMinsplit);
  const [marsDegree, setMarsDegree] = useState(DEFAULT_CONFIG.marsDegree);
  const [marsPenalty, setMarsPenalty] = useState(DEFAULT_CONFIG.marsPenalty);
  const [fdaDegree, setFdaDegree] = useState(DEFAULT_CONFIG.fdaDegree);
  const [annSize, setAnnSize] = useState(DEFAULT_CONFIG.annSize);
  const [annDecay, setAnnDecay] = useState(DEFAULT_CONFIG.annDecay);
  const [annMaxit, setAnnMaxit] = useState(DEFAULT_CONFIG.annMaxit);
  const [annRang, setAnnRang] = useState(DEFAULT_CONFIG.annRang);
  const [marsNk, setMarsNk] = useState<number | undefined>(undefined);
  const [fdaNprune, setFdaNprune] = useState<number | undefined>(undefined);
  const [rfNumTrees, setRfNumTrees] = useState(DEFAULT_CONFIG.rfNumTrees);
  const [rfMtry, setRfMtry] = useState<number | undefined>(undefined);
  const [rfMinNodeSize, setRfMinNodeSize] = useState(DEFAULT_CONFIG.rfMinNodeSize);
  const [xgbMaxDepth, setXgbMaxDepth] = useState(DEFAULT_CONFIG.xgbMaxDepth);
  const [xgbEta, setXgbEta] = useState(DEFAULT_CONFIG.xgbEta);
  const [xgbNrounds, setXgbNrounds] = useState(DEFAULT_CONFIG.xgbNrounds);
  const [bartNtree, setBartNtree] = useState(DEFAULT_CONFIG.bartNtree);
  const [bartNdpost, setBartNdpost] = useState(DEFAULT_CONFIG.bartNdpost);
  const [bartNskip, setBartNskip] = useState(DEFAULT_CONFIG.bartNskip);
  const [brmsChains, setBrmsChains] = useState(DEFAULT_CONFIG.brmsChains);
  const [brmsIter, setBrmsIter] = useState(DEFAULT_CONFIG.brmsIter);
  const [brmsWarmup, setBrmsWarmup] = useState(DEFAULT_CONFIG.brmsWarmup);
  const [inlaMeshMaxEdge, setInlaMeshMaxEdge] = useState<number | undefined>(undefined);
  const [inlaMeshCutoff, setInlaMeshCutoff] = useState<number | undefined>(undefined);
  const [dnnMultispeciesArchitecture, setDnnMultispeciesArchitecture] = useState<"DNN_Small" | "DNN_Medium" | "DNN_Large">(DEFAULT_CONFIG.dnnArchitecture as "DNN_Small" | "DNN_Medium" | "DNN_Large");
  const [dnnMultispeciesNSeeds, _setDnnMultispeciesNSeeds] = useState(3);
  const [biomod2Models, setBiomod2Models] = useState<string[]>(["GLM", "MAXNET", "RF"]);
  const [multiEnsembleModels, _setMultiEnsembleModels] = useState<string[]>(["glm", "rangebag"]);
  const [multiEnsembleBiomod2, _setMultiEnsembleBiomod2] = useState<string[]>(["MAXNET", "RF"]);
  const [multiEnsembleWeighting, setMultiEnsembleWeighting] = useState<"equal" | "auc" | "tss">("auc");
  const [multiEnsemblePower, setMultiEnsemblePower] = useState(2);
  const [multiEnsembleMinAuc, setMultiEnsembleMinAuc] = useState(0.7);
  const [multiEnsembleMinTss, setMultiEnsembleMinTss] = useState(0.5);
  const _toggleBiomod2Model = (algo: string) => { setBiomod2Models(prev => prev.includes(algo) ? prev.filter(a => a !== algo) : [...prev]); };
  const [rangebagNBags, setRangebagNBags] = useState(100);
  const [rangebagBagFraction, setRangebagBagFraction] = useState(0.5);
  const [rangebagVarsPerBag, setRangebagVarsPerBag] = useState(1);
  const [detectionFormula, setDetectionFormula] = useState("~1");
  const [detectionModelType, setDetectionModelType] = useState<"occu" | "occuRN">("occu");

  const [error, setError] = useState<string | null>(null);
  const [climateSource, _setClimateSource] = useState<"worldclim" | "chelsa">("worldclim");
  const [climateRes, _setClimateRes] = useState(10);
  const [missingBiovars, setMissingBiovars] = useState<number[]>([]);
  const [climateCheckLoading, setClimateCheckLoading] = useState(false);
  const deferredSpecies = useDeferredValue(species);
  const speciesFiltered = useMemo(() => speciesSuggestions.filter((s) => s.toLowerCase().includes(deferredSpecies.toLowerCase()) && s !== deferredSpecies).slice(0, 10), [deferredSpecies, speciesSuggestions]);

  useEffect(() => {
    apiGet<Record<string, unknown>[]>("/api/v1/sdm/models").then((models) => {
      if (!models || !Array.isArray(models)) return;
      const toPackages = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
      const defaults = MODEL_BACKENDS.reduce<Record<string, { label: string; maturity: string; min_records: number | null; packages?: string[]; notes?: string; available?: boolean }>>((acc, m) => { acc[m.id] = { label: m.label, maturity: m.maturity, min_records: m.min_records ?? null, packages: toPackages((m as any).packages), notes: (m as any).notes as string | undefined, available: (m as any).available as boolean | undefined }; return acc; }, {});
      const apiModels = models.map((m: Record<string, unknown>) => { const id = m.id as string; const def = defaults[id]; return { id, label: (m.label as string) || def?.label || id, maturity: (m.maturity as string) || def?.maturity || "experimental", min_records: (m.min_records as number) ?? def?.min_records ?? null, packages: toPackages(m.packages).length > 0 ? toPackages(m.packages) : (def?.packages ?? []), notes: (m.notes as string) || def?.notes || "", available: (m.available as boolean) ?? def?.available ?? true }; });
      const mergedIds = new Set(apiModels.map(m => m.id));
      const missingFromApi = MODEL_BACKENDS.filter(m => !mergedIds.has(m.id)).map(m => ({ id: m.id, label: m.label, maturity: m.maturity, min_records: m.min_records ?? null, packages: toPackages((m as any).packages), notes: (m as any).notes as string | undefined, available: (m as any).available as boolean | undefined }));
      setAvailableModels([...apiModels, ...missingFromApi]);
    }).catch(() => {});
  }, []);

  useEffect(() => { useSettingsStore.getState().fetchSettings(); }, []);
  useEffect(() => { apiGet<{ species: { name: string }[] }>("/api/v1/data/species?limit=100").then((data) => { if (data && Array.isArray(data.species)) setSpeciesSuggestions(data.species.map((s: Record<string, unknown>) => s.name as string)); }).catch(() => {}); }, []);

  useEffect(() => {
    if (biovars.length < 2) return;
    const timer = setTimeout(() => {
      setClimateCheckLoading(true);
      fetch(`/api/v1/climate/check?source=${climateSource}&res=${climateRes}&biovars=${biovars.join(",")}`).then((res) => res.ok ? res.json() : null).then((data) => { if (data && Array.isArray(data.available)) setMissingBiovars(biovars.filter((b) => !(data.available as number[]).includes(b))); }).catch(() => setMissingBiovars(biovars)).finally(() => setClimateCheckLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [biovars.join(","), climateSource, climateRes]);

  const toggleBiovar = (id: number) => setBiovars((prev) => prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]);
  const toggleSoilVar = (id: string) => setSoilVars((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  const toggleSoilDepth = (depth: string) => setSoilDepths((prev) => prev.includes(depth) ? prev.filter((d) => d !== depth) : [...prev, depth]);
  const toggleUvVar = (id: string) => setUvVars((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);

  const paramSetters: Record<string, (v: any) => void> = {
    maxnetFeatures: (v) => setMaxnetFeatures(v),
    maxnetRegmult: (v) => setMaxnetRegmult(v as number),
    dnnArchitecture: (v) => setDnnArchitecture(v),
    dnnNSeeds: (v) => setDnnNSeeds(v as number),
    dnnDevice: (v) => setDnnDevice(v),
    brtNTrees: (v) => setBrtNTrees(v as number),
    brtInteractionDepth: (v) => setBrtInteractionDepth(v as number),
    brtShrinkage: (v) => setBrtShrinkage(v as number),
    brtBagFraction: (v) => setBrtBagFraction(v as number),
    ctaCp: (v) => setCtaCp(v as number),
    ctaMaxdepth: (v) => setCtaMaxdepth(v as number),
    ctaMinsplit: (v) => setCtaMinsplit(v as number),
    annSize: (v) => setAnnSize(v as number),
    annDecay: (v) => setAnnDecay(v as number),
    annMaxit: (v) => setAnnMaxit(v as number),
    annRang: (v) => setAnnRang(v as number),
    marsDegree: (v) => setMarsDegree(v as number),
    marsPenalty: (v) => setMarsPenalty(v as number),
    marsNk: (v) => setMarsNk(v as number | undefined),
    fdaDegree: (v) => setFdaDegree(v as number),
    fdaNprune: (v) => setFdaNprune(v as number | undefined),
    rfNumTrees: (v) => setRfNumTrees(v as number),
    rfMtry: (v) => setRfMtry(v as number | undefined),
    rfMinNodeSize: (v) => setRfMinNodeSize(v as number),
    xgbMaxDepth: (v) => setXgbMaxDepth(v as number),
    xgbEta: (v) => setXgbEta(v as number),
    xgbNrounds: (v) => setXgbNrounds(v as number),
    bartNtree: (v) => setBartNtree(v as number),
    bartNdpost: (v) => setBartNdpost(v as number),
    bartNskip: (v) => setBartNskip(v as number),
    brmsChains: (v) => setBrmsChains(v as number),
    brmsIter: (v) => setBrmsIter(v as number),
    brmsWarmup: (v) => setBrmsWarmup(v as number),
    inlaMeshMaxEdge: (v) => setInlaMeshMaxEdge(v as number | undefined),
    inlaMeshCutoff: (v) => setInlaMeshCutoff(v as number | undefined),
    rangebagNBags: (v) => setRangebagNBags(v as number),
    rangebagBagFraction: (v) => setRangebagBagFraction(v as number),
    rangebagVarsPerBag: (v) => setRangebagVarsPerBag(v as number),
    detectionFormula: (v) => setDetectionFormula(v as string),
    detectionModelType: (v) => setDetectionModelType(v),
    dnnMultispeciesArchitecture: (v) => setDnnMultispeciesArchitecture(v),

    multiEnsembleWeighting: (v) => setMultiEnsembleWeighting(v),
    multiEnsemblePower: (v) => setMultiEnsemblePower(v as number),
    multiEnsembleMinAuc: (v) => setMultiEnsembleMinAuc(v as number),
    multiEnsembleMinTss: (v) => setMultiEnsembleMinTss(v as number),
  };

  const handleSubmit = () => {
    setError(null);
    if (cleanedOccurrence && cleanedOccurrence.validRecords === 0) { setError("Cleaned data has 0 valid records. Cannot run model."); return; }
    const extent = extentPreset === "custom" ? customExtent : EXTENT_PRESETS[extentPreset]?.extent;
    if (!extent) { setError("Invalid extent preset"); return; }
    const useCleaned = cleanedOccurrence && cleanedOccurrence.filePath;
    const config = { species, modelId, biovars, projectionExtent: extent, backgroundN, cvFolds, cvStrategy, cvBlockSizeKm: cvStrategy === "spatial_blocks" ? cvBlockSizeKm : undefined, threshold, includeQuadratic, useElevation, useSoil, soilVars, soilDepths, useUv, uvVars, useVegetation, useLulc, useHfp, useBioclimSeason, useDrought, futureProjection, futureWorldclimDir: futureProjection ? buildFutureWorldclimPath(futureGcm, futureSsp, futurePeriod) : undefined, futureLabel, futureWorldclimDir2: future2Enabled ? buildFutureWorldclimPath(future2Gcm, future2Ssp, future2Period) : undefined, futureLabel2: future2Enabled ? future2Label : undefined, extrapolationMask, messThreshold: 0, inlaMeshMaxEdge, inlaMeshCutoff, rangebagNBags, rangebagBagFraction, rangebagVarsPerBag, detectionFormula, detectionModelType, dnnMultispeciesArchitecture, dnnMultispeciesNSeeds, biomod2Models, multiEnsembleModels, multiEnsembleBiomod2, multiEnsembleWeighting, multiEnsemblePower, multiEnsembleMinAuc, multiEnsembleMinTss, vifReduction, climateMatching, thinByCell, mergeSmallSources, minSourceRecords, biasMethod, thickeningDistanceKm, paReplicates, maxnetFeatures, maxnetRegmult, dnnArchitecture, dnnNSeeds, dnnDevice, brtNTrees, brtInteractionDepth, brtShrinkage, brtBagFraction, ctaCp, ctaMaxdepth, ctaMinsplit, marsDegree, marsPenalty, fdaDegree, annSize, annDecay, annMaxit, annRang, marsNk, fdaNprune, rfNumTrees, rfMtry, rfMinNodeSize, xgbMaxDepth, xgbEta, xgbNrounds, bartNtree, bartNdpost, bartNskip, brmsChains, brmsIter, brmsWarmup, aggregationFactor, nCores, seed, occurrenceFile: useCleaned ? cleanedOccurrence!.filePath : (occurrenceFile || ""), cleanedFilePath: useCleaned ? cleanedOccurrence!.filePath : undefined, pipelineRunId: useSDMStore.getState().pipelineRunId || undefined, source: climateSource, worldclimRes: climateRes };
    const parsed = modelConfigSchema.safeParse(config);
    if (!parsed.success) { setError(parsed.error.errors[0].message); return; }
    onSubmit(config);
  };

  const selectedModel = availableModels.find((m) => m.id === modelId);
  const isESM = modelId.startsWith("esm_");
  const effectiveRecordCount = cleanedOccurrence ? cleanedOccurrence.validRecords : recordCount;
  const lowRecordWarning = selectedModel?.min_records && effectiveRecordCount !== null && effectiveRecordCount < selectedModel.min_records;

  const handleSpeciesKeyNav = (dir: "up" | "down" | "enter" | "escape") => {
    if (dir === "down") setSpeciesSelectedIndex((prev) => (prev + 1) % Math.max(speciesFiltered.length, 1));
    else if (dir === "up") setSpeciesSelectedIndex((prev) => (prev - 1 + Math.max(speciesFiltered.length, 1)) % Math.max(speciesFiltered.length, 1));
    else if (dir === "enter" && speciesSelectedIndex >= 0 && speciesSelectedIndex < speciesFiltered.length) { setSpecies(speciesFiltered[speciesSelectedIndex]); setSpeciesStore(speciesFiltered[speciesSelectedIndex]); setSpeciesInputFocused(false); }
    else if (dir === "escape") setSpeciesInputFocused(false);
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 p-3 text-sm text-sdm-danger">{error}</div>}

      {cleanedOccurrence?.filePath ? (
        <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-indigo-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-sdm-text">Cleaned occurrence data ready</p>
            <p className="text-xs text-sdm-muted">{cleanedOccurrence.originalRows.toLocaleString()} original → {cleanedOccurrence.validRecords.toLocaleString()} cleaned records</p>
          </div>
          <Link href="/data?tab=clean" className="text-xs font-medium text-sdm-accent hover:underline shrink-0">Review →</Link>
        </div>
      ) : occurrenceFile ? (
        <div className="rounded-md border border-sdm-success/30 bg-sdm-success/5 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-sdm-success shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-sdm-text truncate">{typeof occurrenceFile === "string" ? occurrenceFile.split("/").pop() : String(occurrenceFile)}</p>
            <p className="text-xs text-sdm-muted truncate">{occurrenceFile}</p>
          </div>
        </div>
      ) : null}

      {cleanedOccurrence && cleanedOccurrence.validRecords === 0 && (
        <div className="rounded-md border border-sdm-danger/30 bg-sdm-danger/5 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-sdm-danger shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-sdm-danger">Cleaning produced 0 valid records</p>
            <p className="text-xs text-sdm-danger">The occurrence data has no valid records after cleaning. Go back to the Data page and check your data.</p>
          </div>
        </div>
      )}
      {!cleanedOccurrence && occurrenceFile && (
        <div className="rounded-md border border-sdm-warning/30 bg-sdm-warning/5 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-sdm-warning shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-sdm-warning">Cleaning recommended</p>
            <p className="text-xs text-sdm-warning">Clean your occurrence data on the <Link href="/data?tab=clean" className="underline">Data page</Link> before running the model.</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Species & Model</h2>

        <SpeciesInput
          species={species}
          speciesFiltered={speciesFiltered}
          speciesSelectedIndex={speciesSelectedIndex}
          focused={speciesInputFocused}
          onSpeciesChange={setSpecies}
          onSelect={(s) => { setSpecies(s); setSpeciesStore(s); setSpeciesInputFocused(false); }}
          onFocus={setSpeciesInputFocused}
          onKeyNav={handleSpeciesKeyNav}
        />

        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">Model backend</label>
          <ModelSelector models={availableModels} selected={modelId} onSelect={setModelId} />
          {isESM && (
            <div className="mt-2 rounded-md bg-sdm-accent-blue/10 border border-sdm-accent-blue/30 p-3 text-xs text-sdm-text">
              <p className="font-medium flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> Ensembles of Small Models (ESM)</p>
              <p className="mt-1 text-sdm-muted">Recommended for rare species with few occurrence records.</p>
            </div>
          )}
          {lowRecordWarning && (
            <div className="mt-2 rounded-md bg-sdm-danger/10 border border-sdm-danger/30 p-3 text-xs text-sdm-danger flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{selectedModel?.label} recommends ≥ {selectedModel.min_records} records. You have {effectiveRecordCount}. Results may be unreliable.</span>
            </div>
          )}
          {selectedModel?.notes && <p className="mt-1 text-xs text-sdm-muted italic">{selectedModel.notes}</p>}
          {selectedModel?.packages && (() => { const pkgs = Array.isArray(selectedModel.packages) ? selectedModel.packages : [selectedModel.packages]; return pkgs.length > 0 ? (<p className="mt-1 text-xs text-sdm-muted">Requires: <code className="text-sdm-text">{pkgs.join(", ")}</code></p>) : null; })()}
        </div>

        <ModelParamPanel modelId={modelId} maxnetFeatures={maxnetFeatures} maxnetRegmult={maxnetRegmult} dnnArchitecture={dnnArchitecture} dnnNSeeds={dnnNSeeds} dnnDevice={dnnDevice} brtNTrees={brtNTrees} brtInteractionDepth={brtInteractionDepth} brtShrinkage={brtShrinkage} brtBagFraction={brtBagFraction} ctaCp={ctaCp} ctaMaxdepth={ctaMaxdepth} ctaMinsplit={ctaMinsplit} annSize={annSize} annDecay={annDecay} annMaxit={annMaxit} annRang={annRang} marsDegree={marsDegree} marsPenalty={marsPenalty} marsNk={marsNk} fdaDegree={fdaDegree} fdaNprune={fdaNprune} rfNumTrees={rfNumTrees} rfMtry={rfMtry} rfMinNodeSize={rfMinNodeSize} xgbMaxDepth={xgbMaxDepth} xgbEta={xgbEta} xgbNrounds={xgbNrounds} bartNtree={bartNtree} bartNdpost={bartNdpost} bartNskip={bartNskip} brmsChains={brmsChains} brmsIter={brmsIter} brmsWarmup={brmsWarmup} inlaMeshMaxEdge={inlaMeshMaxEdge} inlaMeshCutoff={inlaMeshCutoff} rangebagNBags={rangebagNBags} rangebagBagFraction={rangebagBagFraction} rangebagVarsPerBag={rangebagVarsPerBag} detectionFormula={detectionFormula} detectionModelType={detectionModelType} dnnMultispeciesArchitecture={dnnMultispeciesArchitecture} dnnMultispeciesNSeeds={dnnMultispeciesNSeeds} biomod2Models={biomod2Models} multiEnsembleModels={multiEnsembleModels} multiEnsembleBiomod2={multiEnsembleBiomod2} multiEnsembleWeighting={multiEnsembleWeighting} multiEnsemblePower={multiEnsemblePower} multiEnsembleMinAuc={multiEnsembleMinAuc} multiEnsembleMinTss={multiEnsembleMinTss} onSet={(k, v) => paramSetters[k]?.(v)} />
      </div>

      <ClimatePanel biovars={biovars} climateCheckLoading={climateCheckLoading} missingBiovars={missingBiovars} onToggleBiovar={toggleBiovar} />

      <ExtentPanel extentPreset={extentPreset} customExtent={customExtent} threshold={threshold} futureProjection={futureProjection} futureLabel={futureLabel} futureGcm={futureGcm} futureSsp={futureSsp} futurePeriod={futurePeriod} future2Enabled={future2Enabled} future2Label={future2Label} future2Gcm={future2Gcm} future2Ssp={future2Ssp} future2Period={future2Period} extrapolationMask={extrapolationMask} climateSource={climateSource} onSetExtentPreset={setExtentPreset} onSetCustomExtent={setCustomExtent} onSetThreshold={setThreshold} onSetFutureProjection={setFutureProjection} onSetFutureLabel={setFutureLabel} onSetFutureGcm={setFutureGcm} onSetFutureSsp={setFutureSsp} onSetFuturePeriod={setFuturePeriod} onSetFuture2Enabled={setFuture2Enabled} onSetFuture2Label={setFuture2Label} onSetFuture2Gcm={setFuture2Gcm} onSetFuture2Ssp={setFuture2Ssp} onSetFuture2Period={setFuture2Period} onSetExtrapolationMask={setExtrapolationMask} />

      <ModelSettings backgroundN={backgroundN} nCores={nCores} cvFolds={cvFolds} cvStrategy={cvStrategy} paReplicates={paReplicates} aggregationFactor={aggregationFactor} includeQuadratic={includeQuadratic} onSetBackgroundN={setBackgroundN} onSetNCores={setNCores} onSetCvFolds={setCvFolds} onSetCvStrategy={(v) => setCvStrategy(v as any)} onSetPaReplicates={setPaReplicates} onSetAggregationFactor={setAggregationFactor} onSetIncludeQuadratic={setIncludeQuadratic} />

      <CovariatePanel useElevation={useElevation} useSoil={useSoil} soilVars={soilVars} soilDepths={soilDepths} useUv={useUv} uvVars={uvVars} useVegetation={useVegetation} useLulc={useLulc} useHfp={useHfp} useBioclimSeason={useBioclimSeason} useDrought={useDrought} onSetUseElevation={setUseElevation} onSetUseSoil={setUseSoil} onToggleSoilVar={toggleSoilVar} onToggleSoilDepth={toggleSoilDepth} onSetUseUv={setUseUv} onToggleUvVar={toggleUvVar} onSetUseVegetation={setUseVegetation} onSetUseLulc={setUseLulc} onSetUseHfp={setUseHfp} onSetUseBioclimSeason={setUseBioclimSeason} onSetUseDrought={setUseDrought} />

      <AdvancedSettings vifReduction={vifReduction} climateMatching={climateMatching} thinByCell={thinByCell} mergeSmallSources={mergeSmallSources} biasMethod={biasMethod} thickeningDistanceKm={thickeningDistanceKm} minSourceRecords={minSourceRecords} onSetVifReduction={setVifReduction} onSetClimateMatching={setClimateMatching} onSetThinByCell={setThinByCell} onSetMergeSmallSources={setMergeSmallSources} onSetBiasMethod={(v) => setBiasMethod(v as any)} onSetThickeningDistanceKm={setThickeningDistanceKm} onSetMinSourceRecords={setMinSourceRecords} />

      <button onClick={handleSubmit} disabled={loading || !(occurrenceFile || cleanedOccurrence?.filePath) || biovars.length < 2} className="w-full rounded-md bg-sdm-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed">
        {loading ? "Running..." : missingBiovars.length > 0 ? "Run SDM (may download climate data)" : "Run SDM"}
      </button>
    </div>
  );
}
