"use client";

import { useState, useEffect, useRef, useDeferredValue, useMemo, useCallback } from "react";
import { modelConfigSchema, type ModelConfig } from "@sdm/shared";
import { EXTENT_PRESETS, MODEL_BACKENDS, DEFAULT_CONFIG, buildFutureWorldclimPath } from "@sdm/shared";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { TooltipInfo } from "@/components/ui/tooltip";
import Link from "next/link";
import { useSDMStore } from "@/stores/sdm-store";
import { useSettingsStore } from "@/stores/settings-store";
import { apiGet, fetchWithAuth } from "@/services/api";
import { ModelSelector } from "./model-selector";
import { SpeciesInput } from "./species-input";
import { ModelConfigBiovars } from "./model-config-biovars";
import { ModelConfigExtent } from "./model-config-extent";
import { ModelConfigFuture } from "./model-config-future";
import { ModelConfigAdvanced } from "./model-config-advanced";

interface ModelInfo {
  id: string; label: string; maturity: string;
  min_records?: number | null; packages?: string[]; notes?: string; available?: boolean;
  complexity_tier?: string;
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
  const [separateTrainingExtent, setSeparateTrainingExtent] = useState(false);
  const [trainingExtentPreset, setTrainingExtentPreset] = useState("auto");
  const [trainingCustomExtent, setTrainingCustomExtent] = useState<[number, number, number, number]>([112, 154, -44, -10]);
  const [boundary, setBoundary] = useState<"none" | "admin0" | "land" | "custom">("none");
  const [invertMask, setInvertMask] = useState(false);
  const [maskBufferDeg, setMaskBufferDeg] = useState<number | undefined>(undefined);
  const [maskResolution, setMaskResolution] = useState<"auto" | "10m" | "50m" | "110m">("auto");
  const [maskCountry, setMaskCountry] = useState("all");
  const [countries, setCountries] = useState<string[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [customBoundaries, setCustomBoundaries] = useState<Array<{ file_path: string; file_name: string }>>([]);
  const [autoExtentFromBoundary, setAutoExtentFromBoundary] = useState(false);
  const extentBeforeAutoRef = useRef<{ preset: string; custom: [number, number, number, number] } | null>(null);
  useEffect(() => {
    if (!autoExtentFromBoundary && extentBeforeAutoRef.current) {
      setExtentPreset(extentBeforeAutoRef.current.preset);
      setCustomExtent(extentBeforeAutoRef.current.custom);
      extentBeforeAutoRef.current = null;
    }
  }, [autoExtentFromBoundary]);
  const prevBoundary = useRef(boundary);
  useEffect(() => {
    if (prevBoundary.current === "custom" && boundary !== "custom") {
      setMaskCountry("all");
    }
    prevBoundary.current = boundary;
  }, [boundary]);
  const [restrictBackground, setRestrictBackground] = useState(false);
  const [backgroundN, setBackgroundN] = useState(DEFAULT_CONFIG.backgroundN);
  const [cvFolds, setCvFolds] = useState(DEFAULT_CONFIG.cvFolds);
  const [cvStrategy, setCvStrategy] = useState<"random" | "spatial_blocks">("spatial_blocks");
  const [cvBlockSizeKm, setCvBlockSizeKm] = useState(50);
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
  const [generateTiles, setGenerateTiles] = useState(true);
  const [generateCog, setGenerateCog] = useState(true);
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
  const [climateMatchingMethod, setClimateMatchingMethod] = useState<"mahalanobis" | "standardised" | "euclidean">("mahalanobis");
  const [maxnetFeatures, setMaxnetFeatures] = useState<string>(DEFAULT_CONFIG.maxnetFeatures);
  const [maxnetRegmult, setMaxnetRegmult] = useState(DEFAULT_CONFIG.maxnetRegmult);
  const [error, setError] = useState<string | null>(null);

  const [multiEnsembleModels, setMultiEnsembleModels] = useState<string[]>(["glm", "gam", "maxnet", "rf"]);
  const [multiEnsembleWeighting, setMultiEnsembleWeighting] = useState<"auc" | "equal" | "tss">("auc");
  const [multiEnsemblePower, setMultiEnsemblePower] = useState(2);
  const [multiEnsembleMinAuc, setMultiEnsembleMinAuc] = useState(0.7);
  const [multiEnsembleMinTss, setMultiEnsembleMinTss] = useState(0.5);
  const [multiEnsembleExport, setMultiEnsembleExport] = useState(true);
  const [multiEnsembleUncertainty, setMultiEnsembleUncertainty] = useState(true);
  const [biomod2Models, setBiomod2Models] = useState<string[]>(["GLM", "GAM", "RF"]);
  const [esmNRuns, setEsmNRuns] = useState(5);
  const [esmSplit, setEsmSplit] = useState(70);

  const [elevationDemtype, setElevationDemtype] = useState(DEFAULT_CONFIG.elevationDemtype);
  const [vegProducts, setVegProducts] = useState(DEFAULT_CONFIG.vegProducts);
  const [vegProduct, setVegProduct] = useState(DEFAULT_CONFIG.vegProducts[0]);
  const [lulcYear, setLulcYear] = useState(DEFAULT_CONFIG.lulcYear);
  const [vifThreshold, setVifThreshold] = useState(DEFAULT_CONFIG.vifThreshold);
  const [targetGroupFile, setTargetGroupFile] = useState<File | null>(null);
  const [chelsaExtras, setChelsaExtras] = useState<string[]>([]);
  const [hfpYear, setHfpYear] = useState(DEFAULT_CONFIG.hfpYear);
  const [vegYear, setVegYear] = useState<number | undefined>(undefined);
  const [opentopoApiKey, setOpentopoApiKey] = useState("");
  useEffect(() => {
    apiGet<{ value: string }>("/api/v1/admin/system/secrets/service.open_topography_api_key?raw=1")
      .then((data) => { if (data?.value) setOpentopoApiKey(data.value); })
      .catch(() => {});
  }, []);
  const [analysisCrs, setAnalysisCrs] = useState("auto");
  const [esmMinAuc, setEsmMinAuc] = useState(0.7);
  const [esmPower, setEsmPower] = useState(1);
  const [esmWeightingMetric, setEsmWeightingMetric] = useState<"AUC" | "TSS">("AUC");
  const [esmBiovars, setEsmBiovars] = useState<number[] | undefined>(undefined);
  const [droughtPeriods, setDroughtPeriods] = useState<string[]>(["annual_mean"]);
  const [uvMonths, setUvMonths] = useState<string[]>([]);
  const [rangebagNBags, setRangebagNBags] = useState(100);
  const [rangebagBagFraction, setRangebagBagFraction] = useState(0.5);
  const [rangebagVarsPerBag, setRangebagVarsPerBag] = useState(3);

  const [maxnetAutoTune, setMaxnetAutoTune] = useState(false);
  const [rfNumTrees, setRfNumTrees] = useState(500);
  const [rfMtry, setRfMtry] = useState<number | undefined>(undefined);
  const [rfMinNodeSize, setRfMinNodeSize] = useState(10);
  const [gamK, setGamK] = useState(5);
  const [xgbMaxDepth, setXgbMaxDepth] = useState(6);
  const [xgbEta, setXgbEta] = useState(0.3);
  const [xgbNRounds, setXgbNRounds] = useState(100);
  const [dnnArchitecture, setDnnArchitecture] = useState<"DNN_Small" | "DNN_Medium" | "DNN_Large">("DNN_Medium");
  const [dnnDropout, setDnnDropout] = useState(0.3);
  const [dnnL2Lambda, setDnnL2Lambda] = useState(0.001);
  const [dnnNSeeds, setDnnNSeeds] = useState(3);
  const [dnnDevice, setDnnDevice] = useState("auto");
  const [dnnMultispeciesNSeeds, setDnnMultispeciesNSeeds] = useState(3);
  const [brtNTrees, setBrtNTrees] = useState(500);
  const [brtInteractionDepth, setBrtInteractionDepth] = useState(3);
  const [brtShrinkage, setBrtShrinkage] = useState(0.01);
  const [brtBagFraction, setBrtBagFraction] = useState(0.75);
  const [ctaCp, setCtaCp] = useState(0.01);
  const [ctaMaxdepth, setCtaMaxdepth] = useState(10);
  const [ctaMinsplit, setCtaMinsplit] = useState(20);
  const [annSize, setAnnSize] = useState(10);
  const [annDecay, setAnnDecay] = useState(0.01);
  const [annMaxit, setAnnMaxit] = useState(100);
  const [annRang, setAnnRang] = useState(0.1);
  const [marsDegree, setMarsDegree] = useState(2);
  const [marsPenalty, setMarsPenalty] = useState(2);
  const [marsNk, setMarsNk] = useState<number | undefined>(undefined);
  const [fdaDegree, setFdaDegree] = useState(2);
  const [fdaNprune, setFdaNprune] = useState<number | undefined>(undefined);
  const [xgbNrounds, setXgbNrounds] = useState(100);
  const [bartNtree, setBartNtree] = useState(50);
  const [bartNdpost, setBartNdpost] = useState(1000);
  const [bartNskip, setBartNskip] = useState(100);
  const [brmsChains, setBrmsChains] = useState(4);
  const [brmsIter, setBrmsIter] = useState(2000);
  const [brmsWarmup, setBrmsWarmup] = useState(1000);
  const [inlaMeshMaxEdge, setInlaMeshMaxEdge] = useState<number | undefined>(undefined);
  const [inlaMeshCutoff, setInlaMeshCutoff] = useState<number | undefined>(undefined);
  const [detectionFormula, setDetectionFormula] = useState("");
  const [detectionModelType, setDetectionModelType] = useState("");
  const [dnnMultispeciesArchitecture, setDnnMultispeciesArchitecture] = useState<"DNN_Small" | "DNN_Medium" | "DNN_Large">("DNN_Small");

  const [climateSource, setClimateSource] = useState<"worldclim" | "chelsa">("worldclim");
  const [climateRes, setClimateRes] = useState(10);
  const [missingBiovars, setMissingBiovars] = useState<number[]>([]);
  const [climateCheckLoading, setClimateCheckLoading] = useState(false);
  const detectedSpecies = useSDMStore((s) => s.detectedSpecies);
  const deferredSpecies = useDeferredValue(species);
  const speciesFiltered = useMemo(() => {
    const fromDetected = (detectedSpecies || []).filter((s) => s.toLowerCase().includes(deferredSpecies.toLowerCase()) && s !== deferredSpecies);
    const fromHistory = speciesSuggestions.filter((s) => s.toLowerCase().includes(deferredSpecies.toLowerCase()) && s !== deferredSpecies && !fromDetected.includes(s));
    return [...fromDetected, ...fromHistory].slice(0, 10);
  }, [deferredSpecies, speciesSuggestions, detectedSpecies]);

  const currentExtent = useMemo<[number, number, number, number]>(() =>
    extentPreset === "custom" ? customExtent : EXTENT_PRESETS[extentPreset]?.extent ?? [112, 154, -44, -10],
  [extentPreset, customExtent]);
  const extentWidthDeg = useMemo(() => currentExtent[1] - currentExtent[0], [currentExtent]);
  const extentHeightDeg = useMemo(() => currentExtent[3] - currentExtent[2], [currentExtent]);
  const fineDems = ["COP30", "NASADEM", "SRTMGL1", "AW3D30"];
  const coarseDems = ["COP90", "SRTMGL3"];
  const demWarning = useMemo<string | null>(() => {
    if (!useElevation) return null;
    const maxDim = Math.max(extentWidthDeg, extentHeightDeg);
    if (fineDems.includes(elevationDemtype) && maxDim > 5) {
      return "Large extent with 30m DEM — may download >1 GB. Consider COP90 or SRTMGL3.";
    }
    if (coarseDems.includes(elevationDemtype) && maxDim < 1) {
      return "Small extent with coarse DEM — consider a finer option (SRTMGL1, AW3D30, or COP30).";
    }
    return null;
  }, [useElevation, elevationDemtype, extentWidthDeg, extentHeightDeg]);

  useEffect(() => {
    apiGet<Record<string, unknown>[]>("/api/v1/sdm/models").then((models) => {
      if (!models || !Array.isArray(models)) return;
      const toPackages = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);
      const getExtra = (m: Record<string, unknown>) => ({ packages: toPackages(m.packages), notes: m.notes as string | undefined, available: m.available as boolean | undefined });
      const defaults = MODEL_BACKENDS.reduce<Record<string, { label: string; maturity: string; min_records: number | null; packages?: string[]; notes?: string; available?: boolean }>>((acc, m) => { const x = getExtra(m as unknown as Record<string, unknown>); acc[m.id] = { label: m.label, maturity: m.maturity, min_records: m.min_records ?? null, packages: x.packages, notes: x.notes, available: x.available }; return acc; }, {});
      const apiModels = models.map((m: Record<string, unknown>) => { const id = m.id as string; const def = defaults[id]; return { id, label: (m.label as string) || def?.label || id, maturity: (m.maturity as string) || def?.maturity || "experimental", min_records: (m.min_records as number) ?? def?.min_records ?? null, packages: toPackages(m.packages).length > 0 ? toPackages(m.packages) : (def?.packages ?? []), notes: (m.notes as string) || def?.notes || "", available: (m.available as boolean) ?? def?.available ?? true }; });
      const mergedIds = new Set(apiModels.map(m => m.id));
      const missingFromApi = MODEL_BACKENDS.filter(m => !mergedIds.has(m.id)).map(m => { const x = getExtra(m as unknown as Record<string, unknown>); return { id: m.id, label: m.label, maturity: m.maturity, min_records: m.min_records ?? null, packages: x.packages, notes: x.notes, available: x.available }; });
      setAvailableModels([...apiModels, ...missingFromApi]);
    }).catch(() => console.warn("[model-config] Failed to fetch available models from API"));
  }, []);

  useEffect(() => { useSettingsStore.getState().fetchSettings(); }, []);
  useEffect(() => { apiGet<{ species: { name: string }[] }>("/api/v1/data/species?limit=100").then((data) => { if (data && Array.isArray(data.species)) setSpeciesSuggestions(data.species.map((s: Record<string, unknown>) => s.name as string)); }).catch(() => console.warn("[model-config] Failed to fetch species suggestions")); }, []);
  useEffect(() => {
    apiGet<{ boundaries: Array<{ file_path: string; file_name: string }> }>("/api/v1/data/boundary/list")
      .then((data) => setCustomBoundaries(data.boundaries || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (boundary !== "admin0") return;
    setCountriesLoading(true);
    apiGet<{ countries: string[] }>("/api/v1/data/boundary/countries")
      .then((data) => setCountries(data.countries || []))
      .catch(() => setCountries([]))
      .finally(() => setCountriesLoading(false));
  }, [boundary]);

  const countryOptions = useMemo(
    () => ["all", ...countries],
    [countries],
  );

  useEffect(() => {
    if (!autoExtentFromBoundary || boundary === "none") return;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (boundary === "custom") {
          params.set("file_path", maskCountry);
        } else {
          params.set("type", boundary);
          params.set("resolution", maskResolution);
          params.set("country", maskCountry);
        }
        params.set("buffer_deg", "2");
        const data = await apiGet<{ xmin: number; xmax: number; ymin: number; ymax: number }>(
          `/api/v1/data/boundary/extent?${params}`
        );
        if (data && typeof data.xmin === "number") {
          extentBeforeAutoRef.current = { preset: extentPreset, custom: customExtent };
          setExtentPreset("custom");
          setCustomExtent([data.xmin, data.xmax, data.ymin, data.ymax]);
        }
      } catch {
        // Silently fail — extent stays as-is
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [autoExtentFromBoundary, boundary, maskResolution, maskCountry]);

  const biovarKey = useMemo(() => biovars.join(","), [biovars]);

  useEffect(() => {
    if (biovars.length < 2) return;
    const timer = setTimeout(() => {
      setClimateCheckLoading(true);
      fetchWithAuth(`/api/v1/climate/check?source=${climateSource}&res=${climateRes}&biovars=${biovarKey}`).then((res) => res.ok ? res.json() : null).then((data) => { if (data && Array.isArray(data.available)) setMissingBiovars(biovars.filter((b) => !(data.available as number[]).includes(b))); }).catch(() => setMissingBiovars(biovars)).finally(() => setClimateCheckLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [biovarKey, climateSource, climateRes]);

  const toggleBiovar = useCallback((id: number) => setBiovars((prev) => prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]), []);
  const toggleSoilVar = useCallback((id: string) => setSoilVars((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]), []);
  const toggleSoilDepth = useCallback((depth: string) => setSoilDepths((prev) => prev.includes(depth) ? prev.filter((d) => d !== depth) : [...prev, depth]), []);
  const toggleUvVar = useCallback((id: string) => setUvVars((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]), []);

  const toggleEnsembleModel = useCallback((m: string) => {
    setMultiEnsembleModels((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  }, []);

  const toggleBiomod2Model = useCallback((a: string) => {
    setBiomod2Models((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }, []);

  const handleSubmit = () => {
    setError(null);
    if (cleanedOccurrence && cleanedOccurrence.validRecords === 0) { setError("Cleaned data has 0 valid records. Cannot run model."); return; }
    const extent = extentPreset === "custom" ? customExtent : EXTENT_PRESETS[extentPreset]?.extent;
    if (!extent) { setError("Invalid extent preset"); return; }
    const useCleaned = cleanedOccurrence && cleanedOccurrence.filePath;

    const config = {
      species,
      speciesFilter: species,
      modelId,
      biovars,
      projectionExtent: extent,
      trainingExtent: separateTrainingExtent && trainingExtentPreset !== "auto"
        ? (trainingExtentPreset === "custom" ? trainingCustomExtent : EXTENT_PRESETS[trainingExtentPreset]?.extent)
        : undefined,
      maskType: (boundary === "none" ? "none" : invertMask ? "ocean" : "landmass") as "none" | "landmass" | "ocean",
      maskBufferDeg,
      maskFile: boundary === "custom" ? maskCountry : undefined,
      maskBoundaryType: boundary === "none" ? "admin0" : boundary,
      maskResolution,
      maskCountry,
      autoExtentFromBoundary,
      restrictBackground,
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
      uvMonths: useUv ? uvMonths : undefined,
      useVegetation,
      vegYear: useVegetation ? vegYear : undefined,
      useLulc,
      useHfp,
      hfpYear: useHfp ? hfpYear : undefined,
      useBioclimSeason,
      useDrought,
      droughtPeriods: useDrought ? droughtPeriods : undefined,
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
      climateMatchingMethod: climateMatching ? climateMatchingMethod : undefined,
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
      multiEnsembleWeighting: modelId === "multi_ensemble" ? multiEnsembleWeighting : undefined,
      multiEnsemblePower: modelId === "multi_ensemble" ? multiEnsemblePower : undefined,
      multiEnsembleMinAuc: modelId === "multi_ensemble" ? multiEnsembleMinAuc : undefined,
      multiEnsembleMinTss: modelId === "multi_ensemble" ? multiEnsembleMinTss : undefined,
      multiEnsembleExport: modelId === "multi_ensemble" ? multiEnsembleExport : undefined,
      multiEnsembleUncertainty: modelId === "multi_ensemble" ? multiEnsembleUncertainty : undefined,
      biomod2Models: modelId === "biomod2" ? biomod2Models : undefined,
      esmNRuns: isESM ? esmNRuns : undefined,
      esmSplit: isESM ? esmSplit : undefined,
      esmMinAuc: isESM ? esmMinAuc : undefined,
      esmPower: isESM ? esmPower : undefined,
      esmWeightingMetric: isESM ? esmWeightingMetric : undefined,
      esmBiovars: isESM ? esmBiovars : undefined,
      rangebagNBags: isRangebag ? rangebagNBags : undefined,
      rangebagBagFraction: isRangebag ? rangebagBagFraction : undefined,
      rangebagVarsPerBag: isRangebag ? rangebagVarsPerBag : undefined,
      analysisCrs,
      chelsaExtras: climateSource === "chelsa" ? chelsaExtras : undefined,
      opentopoApiKey: useElevation ? opentopoApiKey : undefined,
      maxnetAutoTune: modelId === "maxnet" ? maxnetAutoTune : undefined,
      rfNumTrees: modelId === "rf" ? rfNumTrees : undefined,
      rfMtry: modelId === "rf" ? rfMtry : undefined,
      rfMinNodeSize: modelId === "rf" ? rfMinNodeSize : undefined,
      gamK: modelId === "gam" ? gamK : undefined,
      xgbMaxDepth: modelId === "xgboost" ? xgbMaxDepth : undefined,
      xgbEta: modelId === "xgboost" ? xgbEta : undefined,
      xgbNRounds: modelId === "xgboost" ? xgbNRounds : undefined,
      dnnArchitecture: modelId === "dnn" ? dnnArchitecture : undefined,
      dnnMultispeciesArchitecture: modelId === "dnn_multispecies" ? dnnMultispeciesArchitecture : undefined,
      dnnDropout: modelId === "dnn" ? dnnDropout : undefined,
      dnnL2Lambda: modelId === "dnn" ? dnnL2Lambda : undefined,
      dnnMultispeciesNSeeds: modelId === "dnn_multispecies" ? dnnMultispeciesNSeeds : undefined,
      generateTiles,
      generateCog,
    };

    const parsed = modelConfigSchema.safeParse(config);
    if (!parsed.success) { setError(parsed.error.errors[0].message); return; }
    onSubmit(config as Partial<ModelConfig>);
  };

  const selectedModel = useMemo(() => availableModels.find((m) => m.id === modelId), [availableModels, modelId]);
  const isESM = useMemo(() => modelId.startsWith("esm_"), [modelId]);
  const isRangebag = useMemo(() => modelId === "rangebag" || modelId === "ensemble_glm_rangebag", [modelId]);
  const effectiveRecordCount = useMemo(() => cleanedOccurrence
    ? cleanedOccurrence.validRecords
    : recordCount, [cleanedOccurrence, recordCount]);
  const lowRecordWarning = useMemo(() =>
    selectedModel?.min_records && effectiveRecordCount !== null && effectiveRecordCount < selectedModel.min_records,
  [selectedModel?.min_records, effectiveRecordCount]);
  const recordTier = useMemo(() => selectedModel?.min_records && effectiveRecordCount !== null
    ? effectiveRecordCount < selectedModel.min_records ? "danger"
      : effectiveRecordCount < selectedModel.min_records * 2 ? "warning"
      : effectiveRecordCount < selectedModel.min_records * 3 ? "info"
      : "ok"
    : null,
  [selectedModel?.min_records, effectiveRecordCount]);

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
          <Link href="/data?tab=upload" className="text-xs font-medium text-sdm-accent hover:underline shrink-0">Review →</Link>
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
            <p className="text-xs text-sdm-warning">Clean your occurrence data on the <Link href="/data?tab=upload" className="underline">Data page</Link> before running the model.</p>
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
          detectedSpecies={detectedSpecies}
        />

        <ModelSelector models={availableModels} selected={modelId} onSelect={setModelId} />
        {isESM && (
          <div className="rounded-md bg-sdm-accent-blue/10 border border-sdm-accent-blue/30 p-3 text-xs text-sdm-text">
            <p className="font-medium flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> Ensembles of Small Models (ESM)</p>
            <p className="mt-1 text-sdm-muted">Recommended for rare species with few occurrence records.</p>
          </div>
        )}
        {recordTier === "danger" && selectedModel && (
          <div className="rounded-md bg-sdm-danger/10 border border-sdm-danger/30 p-3 text-xs text-sdm-danger flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{selectedModel.label} requires ≥ {selectedModel.min_records} records. You have {effectiveRecordCount}. Consider ESM or simpler models.</span>
          </div>
        )}
        {recordTier === "warning" && selectedModel && (
          <div className="rounded-md bg-sdm-warning/10 border border-sdm-warning/30 p-3 text-xs text-sdm-warning flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Sample size ({effectiveRecordCount}) is close to minimum for {selectedModel.label} ({selectedModel.min_records}). Consider ESM or reducing model complexity.</span>
          </div>
        )}
        {recordTier === "info" && selectedModel && (
          <div className="rounded-md bg-sdm-accent-blue/10 border border-sdm-accent-blue/30 p-3 text-xs text-sdm-accent-blue flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Larger datasets improve model stability. ≥ {(selectedModel.min_records ?? 15) * 3} records recommended for reliable response curves with {selectedModel.label}.</span>
          </div>
        )}

        {(() => {
          const ct = selectedModel?.complexity_tier;
          if (!ct || effectiveRecordCount === null) return null;
          if (ct === "very_complex" && effectiveRecordCount < 150) {
            return (
              <div className="rounded-md bg-sdm-danger/10 border border-sdm-danger/30 p-3 text-xs text-sdm-danger flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{selectedModel.label} (very complex) needs ≥ 150 records. With {effectiveRecordCount}, overfitting is likely. Choose a simpler model.</span>
              </div>
            );
          }
          if (ct === "complex" && effectiveRecordCount < 150) {
            return (
              <div className="rounded-md bg-sdm-warning/10 border border-sdm-warning/30 p-3 text-xs text-sdm-warning flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{selectedModel.label} (complex) performs best with ≥ 150 records. With {effectiveRecordCount}, consider GLM or MaxNet.</span>
              </div>
            );
          }
          if (ct === "moderate" && effectiveRecordCount < 50) {
            return (
              <div className="rounded-md bg-sdm-warning/10 border border-sdm-warning/30 p-3 text-xs text-sdm-warning flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{selectedModel.label} (moderate) with only {effectiveRecordCount} records. Consider BIOCLIM or ESM for small datasets.</span>
              </div>
            );
          }
          return null;
        })()}
      </div>

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Data processing</h2>
        <p className="text-sm text-sdm-muted">Controls for occurrence data filtering and source management.</p>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={thinByCell} onChange={(e) => setThinByCell(e.target.checked)} />
          Thin duplicate records in same climate cell
          <TooltipInfo content="Keeps 1 occurrence per raster cell, reducing spatial autocorrelation that inflates CV AUC." />
        </label>
        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={mergeSmallSources} onChange={(e) => setMergeSmallSources(e.target.checked)} />
          Merge small occurrence sources
          <TooltipInfo content="Pools small occurrence sources into 'Other', preventing noisy sources from splitting ensemble weight." />
        </label>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">
            Minimum records per source
            <TooltipInfo content="Sources below this count are merged (when merging is enabled)." />
          </label>
          <input type="number" value={minSourceRecords} onChange={(e) => setMinSourceRecords(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
        </div>
      </div>

      <ModelConfigBiovars
        climateSource={climateSource}
        onClimateSourceChange={setClimateSource}
        climateRes={climateRes}
        onClimateResChange={setClimateRes}
        biovars={biovars}
        missingBiovars={missingBiovars}
        climateCheckLoading={climateCheckLoading}
        toggleBiovar={toggleBiovar}
        aggregationFactor={aggregationFactor}
        chelsaExtras={chelsaExtras}
        onChelsaExtrasChange={setChelsaExtras}
      />

      <ModelConfigExtent
        extentPreset={extentPreset}
        onExtentPresetChange={setExtentPreset}
        customExtent={customExtent}
        onCustomExtentChange={setCustomExtent}
        separateTrainingExtent={separateTrainingExtent}
        onSeparateTrainingExtentChange={setSeparateTrainingExtent}
        trainingExtentPreset={trainingExtentPreset}
        onTrainingExtentPresetChange={setTrainingExtentPreset}
        trainingCustomExtent={trainingCustomExtent}
        onTrainingCustomExtentChange={setTrainingCustomExtent}
        boundary={boundary}
        onBoundaryChange={setBoundary}
        invertMask={invertMask}
        onInvertMaskChange={setInvertMask}
        maskBufferDeg={maskBufferDeg}
        onMaskBufferDegChange={setMaskBufferDeg}
        maskResolution={maskResolution}
        onMaskResolutionChange={setMaskResolution}
        maskCountry={maskCountry}
        onMaskCountryChange={setMaskCountry}
        countryOptions={countryOptions}
        countriesLoading={countriesLoading}
        customBoundaries={customBoundaries}
        autoExtentFromBoundary={autoExtentFromBoundary}
        onAutoExtentFromBoundaryChange={setAutoExtentFromBoundary}
        restrictBackground={restrictBackground}
        onRestrictBackgroundChange={setRestrictBackground}
        analysisCrs={analysisCrs}
        onAnalysisCrsChange={setAnalysisCrs}
      />

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Suitability threshold</h2>
        <div>
          <label className="block text-sm font-medium text-sdm-text mb-1">
            High-suitability threshold
            <TooltipInfo content="Suitability threshold for presence/absence. Lower = higher sensitivity but may overpredict. TSS finds the optimal tradeoff." />
          </label>
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
      </div>

      <ModelConfigFuture
        futureProjection={futureProjection}
        onFutureProjectionChange={setFutureProjection}
        futureLabel={futureLabel}
        onFutureLabelChange={setFutureLabel}
        futureGcm={futureGcm}
        onFutureGcmChange={setFutureGcm}
        futureSsp={futureSsp}
        onFutureSspChange={setFutureSsp}
        futurePeriod={futurePeriod}
        onFuturePeriodChange={setFuturePeriod}
        futureProjection2={futureProjection2}
        onFutureProjection2Change={setFutureProjection2}
        futureLabel2={futureLabel2}
        onFutureLabel2Change={setFutureLabel2}
        futureGcm2={futureGcm2}
        onFutureGcm2Change={setFutureGcm2}
        futureSsp2={futureSsp2}
        onFutureSsp2Change={setFutureSsp2}
        futurePeriod2={futurePeriod2}
        onFuturePeriod2Change={setFuturePeriod2}
      />

      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold text-sdm-heading">Computation &amp; Validation</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              Background points
              <TooltipInfo content="Number of pseudo-absence / background points. More points = more stable but slower. 10,000 is standard." />
            </label>
            <input type="number" value={backgroundN} onChange={(e) => setBackgroundN(Number(e.target.value))} min={500} max={100000} step={500} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">CPU cores</label>
            <input type="number" value={nCores} onChange={(e) => setNCores(Number(e.target.value))} min={1} max={64} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              Cross-validation folds
              <TooltipInfo content="More folds = more robust evaluation. 5 is standard; 3 for small data. 0 disables CV entirely." />
            </label>
            <select value={cvFolds} onChange={(e) => setCvFolds(Number(e.target.value))} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
              <option value={0}>Off</option>
              <option value={3}>3-fold</option>
              <option value={5}>5-fold</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              CV strategy
              <TooltipInfo content="Spatial-block CV tests on spatially separated folds, preventing AUC overestimation from clustered records. Random is faster." />
            </label>
            <select value={cvStrategy} onChange={(e) => setCvStrategy(e.target.value as typeof cvStrategy)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
              <option value="random">Random</option>
              <option value="spatial_blocks">Spatial blocks</option>
            </select>
            {cvStrategy === "spatial_blocks" && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Block size (km)
                  <TooltipInfo content="Spatial block side length in km. Smaller = more folds. Auto-estimated from spatial autocorrelation." />
                </label>
                <input type="number" value={cvBlockSizeKm} onChange={(e) => setCvBlockSizeKm(Number(e.target.value))} min={1} max={500} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              PA replicates
              <TooltipInfo content="Each replicate draws different pseudo-absence points. Results are averaged. More = more stable but slower." />
            </label>
            <input type="number" value={paReplicates} onChange={(e) => setPaReplicates(Number(e.target.value))} min={1} max={10} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              Raster aggregation
              <TooltipInfo content="Coarsens raster resolution. 2 = half resolution. Reduces memory and computation at the cost of detail." />
            </label>
            <input type="number" value={aggregationFactor} onChange={(e) => setAggregationFactor(Number(e.target.value))} min={1} max={8} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-sdm-text">
          <input type="checkbox" checked={includeQuadratic} onChange={(e) => setIncludeQuadratic(e.target.checked)} />
          Include quadratic climate responses
          <TooltipInfo content="Quadratic terms (I(x²)) capture non-linear responses. Disable to reduce complexity with small datasets." />
        </label>
      </div>

      <ModelConfigAdvanced
        modelId={modelId}
        isESM={isESM}
        isRangebag={isRangebag}
        maxnetFeatures={maxnetFeatures}
        onMaxnetFeaturesChange={setMaxnetFeatures}
        maxnetRegmult={maxnetRegmult}
        onMaxnetRegmultChange={setMaxnetRegmult}
        maxnetAutoTune={maxnetAutoTune}
        onMaxnetAutoTuneChange={setMaxnetAutoTune}
        multiEnsembleModels={multiEnsembleModels}
        multiEnsembleWeighting={multiEnsembleWeighting}
        multiEnsemblePower={multiEnsemblePower}
        multiEnsembleMinAuc={multiEnsembleMinAuc}
        multiEnsembleMinTss={multiEnsembleMinTss}
        multiEnsembleExport={multiEnsembleExport}
        multiEnsembleUncertainty={multiEnsembleUncertainty}
        onToggleEnsembleModel={toggleEnsembleModel}
        onMultiEnsembleWeightingChange={setMultiEnsembleWeighting}
        onMultiEnsemblePowerChange={setMultiEnsemblePower}
        onMultiEnsembleMinAucChange={setMultiEnsembleMinAuc}
        onMultiEnsembleMinTssChange={setMultiEnsembleMinTss}
        onMultiEnsembleExportChange={setMultiEnsembleExport}
        onMultiEnsembleUncertaintyChange={setMultiEnsembleUncertainty}
        biomod2Models={biomod2Models}
        onToggleBiomod2Model={toggleBiomod2Model}
        esmNRuns={esmNRuns}
        onEsmNRunsChange={setEsmNRuns}
        esmSplit={esmSplit}
        onEsmSplitChange={setEsmSplit}
        esmWeightingMetric={esmWeightingMetric}
        onEsmWeightingMetricChange={setEsmWeightingMetric}
        esmPower={esmPower}
        onEsmPowerChange={setEsmPower}
        esmMinAuc={esmMinAuc}
        onEsmMinAucChange={setEsmMinAuc}
        esmBiovars={esmBiovars}
        onEsmBiovarsChange={setEsmBiovars}
        biovars={biovars}
        rangebagNBags={rangebagNBags}
        onRangebagNBagsChange={setRangebagNBags}
        rangebagBagFraction={rangebagBagFraction}
        onRangebagBagFractionChange={setRangebagBagFraction}
        rangebagVarsPerBag={rangebagVarsPerBag}
        onRangebagVarsPerBagChange={setRangebagVarsPerBag}
        rfNumTrees={rfNumTrees}
        onRfNumTreesChange={setRfNumTrees}
        rfMtry={rfMtry}
        onRfMtryChange={setRfMtry}
        rfMinNodeSize={rfMinNodeSize}
        onRfMinNodeSizeChange={setRfMinNodeSize}
        gamK={gamK}
        onGamKChange={setGamK}
        xgbMaxDepth={xgbMaxDepth}
        onXgbMaxDepthChange={setXgbMaxDepth}
        xgbEta={xgbEta}
        onXgbEtaChange={setXgbEta}
        xgbNRounds={xgbNRounds}
        onXgbNRoundsChange={setXgbNRounds}
        dnnArchitecture={dnnArchitecture}
        onDnnArchitectureChange={setDnnArchitecture}
        dnnDropout={dnnDropout}
        onDnnDropoutChange={setDnnDropout}
        dnnL2Lambda={dnnL2Lambda}
        onDnnL2LambdaChange={setDnnL2Lambda}
        useElevation={useElevation}
        onUseElevationChange={setUseElevation}
        elevationDemtype={elevationDemtype}
        onElevationDemtypeChange={setElevationDemtype}
        opentopoApiKey={opentopoApiKey}
        onOpentopoApiKeyChange={setOpentopoApiKey}
        demWarning={demWarning}
        useSoil={useSoil}
        onUseSoilChange={setUseSoil}
        soilVars={soilVars}
        soilDepths={soilDepths}
        onToggleSoilVar={toggleSoilVar}
        onToggleSoilDepth={toggleSoilDepth}
        useUv={useUv}
        onUseUvChange={setUseUv}
        uvVars={uvVars}
        uvMonths={uvMonths}
        onToggleUvVar={toggleUvVar}
        onUvMonthsChange={setUvMonths}
        useVegetation={useVegetation}
        onUseVegetationChange={setUseVegetation}
        vegProduct={vegProduct}
        onVegProductChange={setVegProduct}
        vegYear={vegYear}
        onVegYearChange={setVegYear}
        useLulc={useLulc}
        onUseLulcChange={setUseLulc}
        lulcYear={lulcYear}
        onLulcYearChange={setLulcYear}
        useHfp={useHfp}
        onUseHfpChange={setUseHfp}
        hfpYear={hfpYear}
        onHfpYearChange={setHfpYear}
        useBioclimSeason={useBioclimSeason}
        onUseBioclimSeasonChange={setUseBioclimSeason}
        useDrought={useDrought}
        onUseDroughtChange={setUseDrought}
        droughtPeriods={droughtPeriods}
        onDroughtPeriodsChange={setDroughtPeriods}
        vifReduction={vifReduction}
        onVifReductionChange={setVifReduction}
        vifThreshold={vifThreshold}
        onVifThresholdChange={setVifThreshold}
        biasMethod={biasMethod}
        onBiasMethodChange={setBiasMethod}
        thickeningDistanceKm={thickeningDistanceKm}
        onThickeningDistanceKmChange={setThickeningDistanceKm}
        climateMatching={climateMatching}
        onClimateMatchingChange={setClimateMatching}
        climateMatchingMethod={climateMatchingMethod}
        onClimateMatchingMethodChange={setClimateMatchingMethod}
        generateTiles={generateTiles}
        onGenerateTilesChange={setGenerateTiles}
        generateCog={generateCog}
        onGenerateCogChange={setGenerateCog}
      />

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
