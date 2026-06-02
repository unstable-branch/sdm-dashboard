"use client";

import { useState, useEffect, useDeferredValue, useMemo } from "react";
import { modelConfigSchema, type ModelConfig } from "@sdm/shared";
import { BIOVAR_CHOICES, EXTENT_PRESETS, MODEL_BACKENDS, DEFAULT_CONFIG, GCM_CHOICES, SSP_CHOICES, TIME_PERIOD_CHOICES, buildFutureWorldclimPath, CHELSA_EXTRA_CHOICES, ANALYSIS_CRS_CHOICES } from "@sdm/shared";
import { SOIL_VARS, SOIL_DEPTHS, UV_VARS } from "@sdm/shared";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Info, CloudOff, Cloud } from "lucide-react";
import { TooltipInfo } from "@/components/ui/tooltip";
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
  const [maskType, setMaskType] = useState<"none" | "landmass" | "ocean">("none");
  const [maskBufferDeg, setMaskBufferDeg] = useState<number | undefined>(undefined);
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
  const [maxnetFeatures, setMaxnetFeatures] = useState(DEFAULT_CONFIG.maxnetFeatures);
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
    }).catch(() => console.warn("[model-config] Failed to fetch available models from API"));
  }, []);

  useEffect(() => { useSettingsStore.getState().fetchSettings(); }, []);
  useEffect(() => { apiGet<{ species: { name: string }[] }>("/api/v1/data/species?limit=100").then((data) => { if (data && Array.isArray(data.species)) setSpeciesSuggestions(data.species.map((s: Record<string, unknown>) => s.name as string)); }).catch(() => console.warn("[model-config] Failed to fetch species suggestions")); }, []);

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
    maxnetAutoTune: (v) => setMaxnetAutoTune(v as boolean),
    gamK: (v) => setGamK(v as number),
    dnnDropout: (v) => setDnnDropout(v as number),
    dnnL2Lambda: (v) => setDnnL2Lambda(v as number),
    dnnMultispeciesArchitecture: (v) => setDnnMultispeciesArchitecture(v),
    dnnMultispeciesNSeeds: (v) => setDnnMultispeciesNSeeds(v as number),

    multiEnsembleWeighting: (v) => setMultiEnsembleWeighting(v),
    multiEnsemblePower: (v) => setMultiEnsemblePower(v as number),
    multiEnsembleMinAuc: (v) => setMultiEnsembleMinAuc(v as number),
    multiEnsembleMinTss: (v) => setMultiEnsembleMinTss(v as number),
  };

  const toggleEnsembleModel = (m: string) => {
    setMultiEnsembleModels((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  };

  const toggleBiomod2Model = (a: string) => {
    setBiomod2Models((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const handleSubmit = () => {
    setError(null);
    if (cleanedOccurrence && cleanedOccurrence.validRecords === 0) { setError("Cleaned data has 0 valid records. Cannot run model."); return; }
    const extent = extentPreset === "custom" ? customExtent : EXTENT_PRESETS[extentPreset]?.extent;
    if (!extent) { setError("Invalid extent preset"); return; }
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
    };

    const parsed = modelConfigSchema.safeParse(config);
    if (!parsed.success) { setError(parsed.error.errors[0].message); return; }
    onSubmit(config);
  };

  const selectedModel = availableModels.find((m) => m.id === modelId);
  const isESM = modelId.startsWith("esm_");
  const isRangebag = modelId === "rangebag" || modelId === "ensemble_glm_rangebag";
  const effectiveRecordCount = cleanedOccurrence
    ? cleanedOccurrence.validRecords
    : recordCount;
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
          <label className="block text-sm font-medium text-sdm-text mb-1">
            Model backend
            <TooltipInfo content="Select the SDM algorithm. GLM is fast and interpretable. RF and XGBoost handle nonlinearity natively. MaxNet is Maxent-compatible. DNN requires 50+ records." />
          </label>
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

        {(modelId === "maxnet") && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <div>
              <label className="block text-sm font-medium text-sdm-text mb-1">
                MaxEnt features
                <TooltipInfo content="Feature class complexity. l (linear) = least flexible; lqpht (all) = most. Simpler = less overfitting." />
              </label>
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
              <label className="block text-sm font-medium text-sdm-text mb-1">
                Regularization multiplier
                <TooltipInfo content="Higher values = stronger regularization = simpler models. Increase (1–5) when AUC is suspiciously high or transferability is poor (range 0.1–10)." />
              </label>
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
            <label className="flex items-center gap-2 text-sm text-sdm-text">
              <input type="checkbox" checked={maxnetAutoTune} onChange={(e) => setMaxnetAutoTune(e.target.checked)} />
              Auto-tune regmult + features
              <TooltipInfo content="Grid search over regmult (0.5, 1, 1.5, 2, 3) x feature sets (lqph, lqp, lp, l), selecting best by CV AUC. Overrides manual settings." />
            </label>
          </div>
        )}

        {modelId === "multi_ensemble" && (
          <>
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
            <p className="text-xs text-sdm-muted">Select 2+ models for the ensemble.</p>
          </div>

          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <p className="text-xs font-semibold text-sdm-heading uppercase tracking-wide">Ensemble weighting</p>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">Weighting method</label>
              <select value={multiEnsembleWeighting} onChange={(e) => setMultiEnsembleWeighting(e.target.value as typeof multiEnsembleWeighting)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
                <option value="auc">AUC-weighted (default)</option>
                <option value="tss">TSS-weighted</option>
                <option value="equal">Equal (unweighted average)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">Weighting power ({multiEnsemblePower})</label>
              <input type="range" min={0.5} max={5} step={0.5} value={multiEnsemblePower} onChange={(e) => setMultiEnsemblePower(Number(e.target.value))} className="w-full" />
              <TooltipInfo content="Higher values exaggerate weight differences between models." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Min AUC filter
                  <TooltipInfo content="Component models with CV AUC below this are excluded. Higher = fewer but stronger models." />
                </label>
                <input type="range" min={0.5} max={1} step={0.05} value={multiEnsembleMinAuc} onChange={(e) => setMultiEnsembleMinAuc(Number(e.target.value))} className="w-full" />
                <span className="text-xs text-sdm-muted">{multiEnsembleMinAuc.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Min TSS filter
                  <TooltipInfo content="Component models with CV TSS below this are excluded. Complements the AUC filter." />
                </label>
                <input type="range" min={0} max={1} step={0.05} value={multiEnsembleMinTss} onChange={(e) => setMultiEnsembleMinTss(Number(e.target.value))} className="w-full" />
                <span className="text-xs text-sdm-muted">{multiEnsembleMinTss.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-sdm-text">
                <input type="checkbox" checked={multiEnsembleExport} onChange={(e) => setMultiEnsembleExport(e.target.checked)} />
                Export individual model rasters
              </label>
              <label className="flex items-center gap-2 text-sm text-sdm-text">
                <input type="checkbox" checked={multiEnsembleUncertainty} onChange={(e) => setMultiEnsembleUncertainty(e.target.checked)} />
                Compute uncertainty (SD) raster
              </label>
            </div>
          </div>
          </>
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
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Weighting metric
                </label>
                <select value={esmWeightingMetric} onChange={(e) => setEsmWeightingMetric(e.target.value as typeof esmWeightingMetric)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                  <option value="AUC">AUC</option>
                  <option value="TSS">TSS</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Weighting power ({esmPower})
                  <TooltipInfo content="Weight power. Higher values exaggerate weight differences between top and weak bivariate models." />
                </label>
                <input type="range" min={0.5} max={5} step={0.5} value={esmPower} onChange={(e) => setEsmPower(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Min AUC filter
                  <TooltipInfo content="Bivariate models below this AUC are dropped. Higher = more conservative ensemble." />
                </label>
                <input type="range" min={0.5} max={1} step={0.05} value={esmMinAuc} onChange={(e) => setEsmMinAuc(Number(e.target.value))} className="w-full" />
                <span className="text-xs text-sdm-muted">{esmMinAuc.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  BIO variable subset
                  <TooltipInfo content="Subset of BIO variables for ESM bivariate models. Default = same as main model." />
                </label>
                <select value={esmBiovars ? "custom" : "all"} onChange={(e) => setEsmBiovars(e.target.value === "all" ? undefined : biovars)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                  <option value="all">Same as main model</option>
                  <option value="custom">Use main biovars</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {(modelId === "rangebag" || modelId === "ensemble_glm_rangebag") && (
          <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
            <p className="text-xs font-semibold text-sdm-heading uppercase tracking-wide">Rangebag settings</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Bags ({rangebagNBags})
                  <TooltipInfo content="Number of bootstrap bags. More = more stable but slower. Default 100." />
                </label>
                <input type="range" min={10} max={500} step={10} value={rangebagNBags} onChange={(e) => setRangebagNBags(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Bag fraction ({rangebagBagFraction.toFixed(2)})
                  <TooltipInfo content="Fraction of presence records per bag. Lower = more diversity, less overfitting." />
                </label>
                <input type="range" min={0.1} max={1} step={0.05} value={rangebagBagFraction} onChange={(e) => setRangebagBagFraction(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Vars per bag ({rangebagVarsPerBag})
                  <TooltipInfo content="Random covariates per bag. Fewer = more regularization, less overfitting." />
                </label>
                <input type="range" min={1} max={20} step={1} value={rangebagVarsPerBag} onChange={(e) => setRangebagVarsPerBag(Number(e.target.value))} className="w-full" />
              </div>
            </div>
          </div>
        )}

        {modelId === "rf" && (
          <details className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sdm-heading uppercase tracking-wide">RF tuning</summary>
            <div className="px-3 pb-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Trees ({rfNumTrees})
                  <TooltipInfo content="Number of trees. More = more stable predictions. 500 is standard; 1000+ for production." />
                </label>
                <input type="range" min={100} max={2000} step={100} value={rfNumTrees} onChange={(e) => setRfNumTrees(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Mtry (blank = auto)
                  <TooltipInfo content="Covariates sampled per split. Lower = more regularization. Auto (sqrt) is usually optimal." />
                </label>
                <input type="number" value={rfMtry ?? ""} onChange={(e) => setRfMtry(e.target.value ? Number(e.target.value) : undefined)} min={1} max={50} placeholder="auto" className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Min node size ({rfMinNodeSize})
                  <TooltipInfo content="Minimum data points per leaf node. Larger = simpler trees, less overfitting. Default 10." />
                </label>
                <input type="range" min={1} max={100} step={5} value={rfMinNodeSize} onChange={(e) => setRfMinNodeSize(Number(e.target.value))} className="w-full" />
              </div>
            </div>
          </details>
        )}

        {modelId === "gam" && (
          <details className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sdm-heading uppercase tracking-wide">GAM tuning</summary>
            <div className="px-3 pb-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Basis dimension k ({gamK})
                  <TooltipInfo content="Smooth basis dimension. Higher k = more flexible = more overfitting risk. Start at 5." />
                </label>
                <input type="range" min={3} max={15} step={1} value={gamK} onChange={(e) => setGamK(Number(e.target.value))} className="w-full" />
              </div>
            </div>
          </details>
        )}

        {modelId === "xgboost" && (
          <details className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sdm-heading uppercase tracking-wide">XGBoost tuning</summary>
            <div className="px-3 pb-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Max depth ({xgbMaxDepth})
                  <TooltipInfo content="Maximum tree depth. Deeper = more complex = more overfitting. Start at 6." />
                </label>
                <input type="range" min={3} max={12} step={1} value={xgbMaxDepth} onChange={(e) => setXgbMaxDepth(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Learning rate ({xgbEta})
                  <TooltipInfo content="Learning rate. Lower = more robust but needs more rounds. 0.3 is standard; reduce to 0.1-0.01 with more rounds." />
                </label>
                <input type="number" min={0.01} max={0.5} step={0.01} value={xgbEta} onChange={(e) => setXgbEta(Number(e.target.value))} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Boosting rounds ({xgbNRounds})
                  <TooltipInfo content="Boosting rounds. More = better fit but risk of overfitting. Pair with early stopping." />
                </label>
                <input type="range" min={50} max={500} step={50} value={xgbNRounds} onChange={(e) => setXgbNRounds(Number(e.target.value))} className="w-full" />
              </div>
            </div>
          </details>
        )}

        {modelId === "dnn" && (
          <details className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sdm-heading uppercase tracking-wide">DNN tuning</summary>
            <div className="px-3 pb-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Architecture
                  <TooltipInfo content="Hidden layer config. Small (64) for under 250 records, Medium (100-100) for most cases, Large (100-100-100) for over 1000 records." />
                </label>
                <select value={dnnArchitecture} onChange={(e) => setDnnArchitecture(e.target.value as typeof dnnArchitecture)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                  <option value="DNN_Small">DNN Small (64 units, 1 layer)</option>
                  <option value="DNN_Medium">DNN Medium (100-100, 2 layers)</option>
                  <option value="DNN_Large">DNN Large (100-100-100, 3 layers)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Dropout ({dnnDropout.toFixed(2)})
                  <TooltipInfo content="Fraction of neurons dropped per layer. Higher = more regularization. 0.3 is standard." />
                </label>
                <input type="range" min={0} max={0.5} step={0.05} value={dnnDropout} onChange={(e) => setDnnDropout(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  L2 lambda
                  <TooltipInfo content="L2 weight decay penalty. Higher = stronger regularization. 0.001 is standard." />
                </label>
                <input type="number" min={0.0001} max={0.1} step={0.0001} value={dnnL2Lambda} onChange={(e) => setDnnL2Lambda(Number(e.target.value))} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
              </div>
            </div>
          </details>
        )}

      </div>

      <ClimatePanel biovars={biovars} climateCheckLoading={climateCheckLoading} missingBiovars={missingBiovars} onToggleBiovar={toggleBiovar} />

      <div className="space-y-4">
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
              <span className="font-medium" title={bio.description}>{bio.label}</span>
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

        {climateSource === "chelsa" && (
          <div className="border-t border-sdm-border pt-4 mt-2">
            <h3 className="text-sm font-semibold text-sdm-heading mb-2">CHELSA extra variables</h3>
            <p className="text-xs text-sdm-muted mb-2">Additional bioclimatic variables available with CHELSA v2.1.</p>
            <div className="flex flex-wrap gap-2">
              {CHELSA_EXTRA_CHOICES.map((v: { id: string; label: string; description: string }) => (
                <label
                  key={v.id}
                  title={v.description}
                  className={cn(
                    "px-2 py-1 rounded text-xs cursor-pointer border",
                    chelsaExtras.includes(v.id)
                      ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent"
                      : "border-sdm-border text-sdm-muted"
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={chelsaExtras.includes(v.id)} onChange={() => setChelsaExtras((prev) => prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id])} />
                  {v.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <CovariatePanel useElevation={useElevation} useSoil={useSoil} soilVars={soilVars} soilDepths={soilDepths} useUv={useUv} uvVars={uvVars} useVegetation={useVegetation} useLulc={useLulc} useHfp={useHfp} useBioclimSeason={useBioclimSeason} useDrought={useDrought} onSetUseElevation={setUseElevation} onSetUseSoil={setUseSoil} onToggleSoilVar={toggleSoilVar} onToggleSoilDepth={toggleSoilDepth} onSetUseUv={setUseUv} onToggleUvVar={toggleUvVar} onSetUseVegetation={setUseVegetation} onSetUseLulc={setUseLulc} onSetUseHfp={setUseHfp} onSetUseBioclimSeason={setUseBioclimSeason} onSetUseDrought={setUseDrought} />

      <AdvancedSettings vifReduction={vifReduction} climateMatching={climateMatching} thinByCell={thinByCell} mergeSmallSources={mergeSmallSources} biasMethod={biasMethod} thickeningDistanceKm={thickeningDistanceKm} minSourceRecords={minSourceRecords} onSetVifReduction={setVifReduction} onSetClimateMatching={setClimateMatching} onSetThinByCell={setThinByCell} onSetMergeSmallSources={setMergeSmallSources} onSetBiasMethod={(v) => setBiasMethod(v as any)} onSetThickeningDistanceKm={setThickeningDistanceKm} onSetMinSourceRecords={setMinSourceRecords} />

      <div className="space-y-4">
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
          <label className="block text-sm font-medium text-sdm-text mb-1">
            Analysis CRS
            <TooltipInfo content="Projection for area calculations (EOO/AOO) and distance metrics. Auto-detect UTM is usually best." />
          </label>
          <select
            value={analysisCrs}
            onChange={(e) => setAnalysisCrs(e.target.value)}
            className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
          >
            {ANALYSIS_CRS_CHOICES.map((crs: { id: string; label: string; description: string }) => (
              <option key={crs.id} value={crs.id} title={crs.description}>{crs.label}</option>
            ))}
          </select>
        </div>

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

        <div className="pt-2 border-t border-sdm-border">
          <h3 className="text-sm font-semibold text-sdm-heading mb-2">Boundary masking</h3>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Mask type
                <TooltipInfo content="Clips suitability to landmass or ocean boundary. Uses Natural Earth 1:110m Admin 0 countries." />
              </label>
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
                <TooltipInfo content="Clips suitability to landmass or ocean boundary. Uses Natural Earth 1:110m Admin 0 countries." />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-sdm-border pt-4">
          <h3 className="text-sm font-semibold text-sdm-heading mb-3">Climate matching</h3>
          <p className="text-xs text-sdm-muted mb-3">
            Computes environmental similarity (MESS) between training and projection areas. Helps detect
            extrapolation beyond the climate range used for model training.
          </p>
          <label className="flex items-center gap-2 text-sm text-sdm-text mb-2">
            <input type="checkbox" checked={climateMatching} onChange={(e) => setClimateMatching(e.target.checked)} />
            Compute climate matching
          </label>
          {climateMatching && (
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">Distance method</label>
              <select
                value={climateMatchingMethod}
                onChange={(e) => setClimateMatchingMethod(e.target.value as typeof climateMatchingMethod)}
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
              >
                <option value="mahalanobis">Mahalanobis (multivariate, recommended)</option>
                <option value="standardised">Standardised Euclidean</option>
                <option value="euclidean">Raw Euclidean</option>
              </select>
            </div>
          )}
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
            {useElevation && (
              <div className="ml-6 mt-2">
                <label className="block text-xs font-medium text-sdm-muted mb-1">OpenTopography API key</label>
                <input type="password" value={opentopoApiKey} onChange={(e) => setOpentopoApiKey(e.target.value)} placeholder="Optional — required for SRTMGL1 & AW3D30" className="w-full max-w-xs rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1.5 text-xs text-sdm-text" />
              </div>
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
            <TooltipInfo content="Select months for UV variables. Leave empty to load all months." />
          </label>
          {useUv && (
            <div className="flex flex-wrap gap-2 ml-6">
              {UV_VARS.map((v: { id: string; label: string }) => (
                <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", uvVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                  <input type="checkbox" checked={uvVars.includes(v.id)} onChange={() => toggleUvVar(v.id)} className="sr-only" />
                  {v.label}
                </label>
              ))}
              <div className="flex flex-wrap gap-2 mt-2">
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month) => (
                  <label key={month} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", uvMonths.includes(month) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" className="sr-only" checked={uvMonths.includes(month)} onChange={() => setUvMonths((prev) => prev.includes(month) ? prev.filter((x) => x !== month) : [...prev, month])} />
                    {month.slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useVegetation} onChange={(e) => setUseVegetation(e.target.checked)} />
              Add vegetation productivity
            </label>
            {useVegetation && (
              <div className="flex items-center gap-2 ml-2">
                <select value={vegProduct} onChange={(e) => setVegProduct(e.target.value)} className="rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                  {["ndvi_annual_mean", "evi_annual_mean", "fc_overall", "fpar_mean", "lai_mean", "gpp_mean", "ndvi_peak", "ndvi_min"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <input type="number" value={vegYear ?? ""} onChange={(e) => setVegYear(e.target.value ? Number(e.target.value) : undefined)} placeholder="Year" min={2000} max={2025} className="w-20 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text" />
              </div>
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
          {useHfp && (
            <div className="ml-6">
              <label className="block text-xs font-medium text-sdm-muted mb-1">Year</label>
              <select value={hfpYear} onChange={(e) => setHfpYear(Number(e.target.value))} className="rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                {[2000, 2005, 2010, 2015, 2020].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useBioclimSeason} onChange={(e) => setUseBioclimSeason(e.target.checked)} />
            Add bioclimatic seasonality
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useDrought} onChange={(e) => setUseDrought(e.target.checked)} />
            Add drought index (scPDSI)
            <TooltipInfo content="Select annual, wet, or dry season periods. Empty = all periods loaded." />
          </label>
          {useDrought && (
            <div className="ml-6">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "annual_mean", label: "Annual mean" },
                  { id: "wet_season", label: "Wet season" },
                  { id: "dry_season", label: "Dry season" },
                ].map((p) => (
                  <label key={p.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", droughtPeriods.includes(p.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" className="sr-only" checked={droughtPeriods.includes(p.id)} onChange={() => setDroughtPeriods((prev) => prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-sdm-border bg-sdm-surface">
        <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-sdm-heading">Advanced settings</summary>
        <div className="px-6 pb-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={vifReduction} onChange={(e) => setVifReduction(e.target.checked)} />
              Drop collinear covariates (VIF reduction)
              <TooltipInfo content="VIF removes collinear predictors until remaining VIF ≤ threshold. Lower = more aggressive. 10 is standard; 5 is conservative." />
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
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              Background sampling bias correction
              <TooltipInfo content="Target-group or thickened bias corrects uneven sampling effort. Without it, models overfit to spatially clustered records." />
            </label>
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
              <label className="block text-sm font-medium text-sdm-text mb-1">
                Kernel distance (km)
                <TooltipInfo content="Kernel bandwidth (km) for thickened background. Wider = broader bias correction." />
              </label>
              <input type="number" value={thickeningDistanceKm} onChange={(e) => setThickeningDistanceKm(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
          )}
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
