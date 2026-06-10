"use client";

import { SOIL_VARS, SOIL_DEPTHS, UV_VARS } from "@sdm/shared";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { TooltipInfo } from "@/components/ui/tooltip";

interface ModelConfigAdvancedProps {
  modelId: string;
  isESM: boolean;
  isRangebag: boolean;

  gllvmFamily: "binomial" | "poisson" | "negative.binomial";
  onGllvmFamilyChange: (val: "binomial" | "poisson" | "negative.binomial") => void;
  gllvmNumLv: number;
  onGllvmNumLvChange: (val: number) => void;
  gllvmNumRows: number;
  onGllvmNumRowsChange: (val: number) => void;
  gllvmLvCorr: boolean;
  onGllvmLvCorrChange: (val: boolean) => void;

  maxnetFeatures: string;
  onMaxnetFeaturesChange: (val: string) => void;
  maxnetRegmult: number;
  onMaxnetRegmultChange: (val: number) => void;
  maxnetAutoTune: boolean;
  onMaxnetAutoTuneChange: (val: boolean) => void;
  tuningMethod: "none" | "enmeval";
  onTuningMethodChange: (val: "none" | "enmeval") => void;
  enmevalAlgorithm: string;
  onEnmevalAlgorithmChange: (val: string) => void;
  enmevalPartitions: string;
  onEnmevalPartitionsChange: (val: string) => void;
  enmevalSelectionMetric: string;
  onEnmevalSelectionMetricChange: (val: string) => void;
  enmevalTuneArgs: Record<string, unknown>;
  onEnmevalTuneArgsChange: (val: Record<string, unknown>) => void;
  enmevalNullIterations: number;
  onEnmevalNullIterationsChange: (val: number) => void;

  multiEnsembleModels: string[];
  multiEnsembleWeighting: "auc" | "equal" | "tss";
  multiEnsemblePower: number;
  multiEnsembleMinAuc: number;
  multiEnsembleMinTss: number;
  multiEnsembleExport: boolean;
  multiEnsembleUncertainty: boolean;
  onToggleEnsembleModel: (m: string) => void;
  onMultiEnsembleWeightingChange: (val: "auc" | "equal" | "tss") => void;
  onMultiEnsemblePowerChange: (val: number) => void;
  onMultiEnsembleMinAucChange: (val: number) => void;
  onMultiEnsembleMinTssChange: (val: number) => void;
  onMultiEnsembleExportChange: (val: boolean) => void;
  onMultiEnsembleUncertaintyChange: (val: boolean) => void;

  biomod2Models: string[];
  onToggleBiomod2Model: (a: string) => void;

  esmNRuns: number;
  onEsmNRunsChange: (val: number) => void;
  esmSplit: number;
  onEsmSplitChange: (val: number) => void;
  esmWeightingMetric: "AUC" | "TSS";
  onEsmWeightingMetricChange: (val: "AUC" | "TSS") => void;
  esmPower: number;
  onEsmPowerChange: (val: number) => void;
  esmMinAuc: number;
  onEsmMinAucChange: (val: number) => void;
  esmBiovars: number[] | undefined;
  onEsmBiovarsChange: (val: number[] | undefined) => void;
  biovars: number[];

  rangebagNBags: number;
  onRangebagNBagsChange: (val: number) => void;
  rangebagBagFraction: number;
  onRangebagBagFractionChange: (val: number) => void;
  rangebagVarsPerBag: number;
  onRangebagVarsPerBagChange: (val: number) => void;

  rfNumTrees: number;
  onRfNumTreesChange: (val: number) => void;
  rfMtry: number | undefined;
  onRfMtryChange: (val: number | undefined) => void;
  rfMinNodeSize: number;
  onRfMinNodeSizeChange: (val: number) => void;

  gamK: number;
  onGamKChange: (val: number) => void;

  xgbMaxDepth: number;
  onXgbMaxDepthChange: (val: number) => void;
  xgbEta: number;
  onXgbEtaChange: (val: number) => void;
  xgbNRounds: number;
  onXgbNRoundsChange: (val: number) => void;

  dnnArchitecture: "DNN_Small" | "DNN_Medium" | "DNN_Large";
  onDnnArchitectureChange: (val: "DNN_Small" | "DNN_Medium" | "DNN_Large") => void;
  dnnDropout: number;
  onDnnDropoutChange: (val: number) => void;
  dnnL2Lambda: number;
  onDnnL2LambdaChange: (val: number) => void;
  dnnNSeeds: number;
  onDnnNSeedsChange: (val: number) => void;

  dnnDevice: "auto" | "cpu" | "gpu";
  onDnnDeviceChange: (val: "auto" | "cpu" | "gpu") => void;
  dnnFusedAdam: "auto" | "always" | "off";
  onDnnFusedAdamChange: (val: "auto" | "always" | "off") => void;

  dnnMultispeciesArchitecture: "DNN_Small" | "DNN_Medium" | "DNN_Large";
  onDnnMultispeciesArchitectureChange: (val: "DNN_Small" | "DNN_Medium" | "DNN_Large") => void;
  dnnMultispeciesNSeeds: number;
  onDnnMultispeciesNSeedsChange: (val: number) => void;

  useElevation: boolean;
  onUseElevationChange: (val: boolean) => void;
  elevationDemtype: string;
  onElevationDemtypeChange: (val: string) => void;
  opentopoApiKey: string;
  onOpentopoApiKeyChange: (val: string) => void;
  demWarning: string | null;

  useSoil: boolean;
  onUseSoilChange: (val: boolean) => void;
  soilVars: string[];
  soilDepths: string[];
  onToggleSoilVar: (id: string) => void;
  onToggleSoilDepth: (depth: string) => void;

  useUv: boolean;
  onUseUvChange: (val: boolean) => void;
  uvVars: string[];
  uvMonths: string[];
  onToggleUvVar: (id: string) => void;
  onUvMonthsChange: (val: string[]) => void;

  useVegetation: boolean;
  onUseVegetationChange: (val: boolean) => void;
  vegProduct: string;
  onVegProductChange: (val: string) => void;
  vegYear: number | undefined;
  onVegYearChange: (val: number | undefined) => void;

  useLulc: boolean;
  onUseLulcChange: (val: boolean) => void;
  lulcYear: number;
  onLulcYearChange: (val: number) => void;

  useHfp: boolean;
  onUseHfpChange: (val: boolean) => void;
  hfpYear: number;
  onHfpYearChange: (val: number) => void;

  useBioclimSeason: boolean;
  onUseBioclimSeasonChange: (val: boolean) => void;

  useDrought: boolean;
  onUseDroughtChange: (val: boolean) => void;
  droughtPeriods: string[];
  onDroughtPeriodsChange: (val: string[]) => void;

  vifReduction: boolean;
  onVifReductionChange: (val: boolean) => void;
  vifThreshold: number;
  onVifThresholdChange: (val: number) => void;

  biasMethod: "uniform" | "target_group" | "thickened";
  onBiasMethodChange: (val: "uniform" | "target_group" | "thickened") => void;
  thickeningDistanceKm: number;
  onThickeningDistanceKmChange: (val: number) => void;

  climateMatching: boolean;
  onClimateMatchingChange: (val: boolean) => void;
  climateMatchingMethod: "mahalanobis" | "standardised" | "euclidean";
  onClimateMatchingMethodChange: (val: "mahalanobis" | "standardised" | "euclidean") => void;

  generateTiles: boolean;
  onGenerateTilesChange: (val: boolean) => void;
  generateCog: boolean;
  onGenerateCogChange: (val: boolean) => void;
}

export function ModelConfigAdvanced({
  modelId, isESM, isRangebag,
  maxnetFeatures, onMaxnetFeaturesChange, maxnetRegmult, onMaxnetRegmultChange, maxnetAutoTune, onMaxnetAutoTuneChange,
  tuningMethod, onTuningMethodChange, enmevalAlgorithm, onEnmevalAlgorithmChange, enmevalPartitions, onEnmevalPartitionsChange, enmevalSelectionMetric, onEnmevalSelectionMetricChange, enmevalTuneArgs, onEnmevalTuneArgsChange, enmevalNullIterations, onEnmevalNullIterationsChange,
  multiEnsembleModels, multiEnsembleWeighting, multiEnsemblePower, multiEnsembleMinAuc, multiEnsembleMinTss, multiEnsembleExport, multiEnsembleUncertainty, onToggleEnsembleModel, onMultiEnsembleWeightingChange, onMultiEnsemblePowerChange, onMultiEnsembleMinAucChange, onMultiEnsembleMinTssChange, onMultiEnsembleExportChange, onMultiEnsembleUncertaintyChange,
  biomod2Models, onToggleBiomod2Model,
  esmNRuns, onEsmNRunsChange, esmSplit, onEsmSplitChange, esmWeightingMetric, onEsmWeightingMetricChange, esmPower, onEsmPowerChange, esmMinAuc, onEsmMinAucChange, esmBiovars, onEsmBiovarsChange, biovars,
  rangebagNBags, onRangebagNBagsChange, rangebagBagFraction, onRangebagBagFractionChange, rangebagVarsPerBag, onRangebagVarsPerBagChange,
  rfNumTrees, onRfNumTreesChange, rfMtry, onRfMtryChange, rfMinNodeSize, onRfMinNodeSizeChange,
  gamK, onGamKChange,
  xgbMaxDepth, onXgbMaxDepthChange, xgbEta, onXgbEtaChange, xgbNRounds, onXgbNRoundsChange,
  dnnArchitecture, onDnnArchitectureChange, dnnDropout, onDnnDropoutChange, dnnL2Lambda, onDnnL2LambdaChange, dnnNSeeds, onDnnNSeedsChange, dnnDevice, onDnnDeviceChange, dnnFusedAdam, onDnnFusedAdamChange,
  dnnMultispeciesArchitecture, onDnnMultispeciesArchitectureChange, dnnMultispeciesNSeeds, onDnnMultispeciesNSeedsChange,
  gllvmFamily, onGllvmFamilyChange, gllvmNumLv, onGllvmNumLvChange, gllvmNumRows, onGllvmNumRowsChange, gllvmLvCorr, onGllvmLvCorrChange,
  useElevation, onUseElevationChange, elevationDemtype, onElevationDemtypeChange, opentopoApiKey, onOpentopoApiKeyChange, demWarning,
  useSoil, onUseSoilChange, soilVars, soilDepths, onToggleSoilVar, onToggleSoilDepth,
  useUv, onUseUvChange, uvVars, uvMonths, onToggleUvVar, onUvMonthsChange,
  useVegetation, onUseVegetationChange, vegProduct, onVegProductChange, vegYear, onVegYearChange,
  useLulc, onUseLulcChange, lulcYear, onLulcYearChange,
  useHfp, onUseHfpChange, hfpYear, onHfpYearChange,
  useBioclimSeason, onUseBioclimSeasonChange,
  useDrought, onUseDroughtChange, droughtPeriods, onDroughtPeriodsChange,
  vifReduction, onVifReductionChange, vifThreshold, onVifThresholdChange,
  biasMethod, onBiasMethodChange, thickeningDistanceKm, onThickeningDistanceKmChange,
  climateMatching, onClimateMatchingChange, climateMatchingMethod, onClimateMatchingMethodChange,
  generateTiles, onGenerateTilesChange, generateCog, onGenerateCogChange,
}: ModelConfigAdvancedProps) {
  return (
    <>
      {(modelId === "maxnet") && (
        <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
          <div>
            <label className="block text-sm font-medium text-sdm-text mb-1">
              MaxEnt features
              <TooltipInfo content="Feature class complexity. l (linear) = least flexible; lqpht (all) = most. Simpler = less overfitting." />
            </label>
            <select
              value={maxnetFeatures}
              onChange={(e) => onMaxnetFeaturesChange(e.target.value)}
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
              onChange={(e) => onMaxnetRegmultChange(Number(e.target.value))}
              min={0.1}
              max={10}
              step={0.1}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={maxnetAutoTune} onChange={(e) => onMaxnetAutoTuneChange(e.target.checked)} />
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
                <input type="checkbox" className="sr-only" checked={multiEnsembleModels.includes(m)} onChange={() => onToggleEnsembleModel(m)} />
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
            <select value={multiEnsembleWeighting} onChange={(e) => onMultiEnsembleWeightingChange(e.target.value as typeof multiEnsembleWeighting)} className="w-full rounded-md border border-sdm-border bg-sdm-surface px-3 py-2 text-sm text-sdm-text">
              <option value="auc">AUC-weighted (default)</option>
              <option value="tss">TSS-weighted</option>
              <option value="equal">Equal (unweighted average)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-sdm-muted mb-1">Weighting power ({multiEnsemblePower})</label>
            <input type="range" min={0.5} max={5} step={0.5} value={multiEnsemblePower} onChange={(e) => onMultiEnsemblePowerChange(Number(e.target.value))} className="w-full" />
            <TooltipInfo content="Higher values exaggerate weight differences between models." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Min AUC filter
                <TooltipInfo content="Component models with CV AUC below this are excluded. Higher = fewer but stronger models." />
              </label>
              <input type="range" min={0.5} max={1} step={0.05} value={multiEnsembleMinAuc} onChange={(e) => onMultiEnsembleMinAucChange(Number(e.target.value))} className="w-full" />
              <span className="text-xs text-sdm-muted">{multiEnsembleMinAuc.toFixed(2)}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Min TSS filter
                <TooltipInfo content="Component models with CV TSS below this are excluded. Complements the AUC filter." />
              </label>
              <input type="range" min={0} max={1} step={0.05} value={multiEnsembleMinTss} onChange={(e) => onMultiEnsembleMinTssChange(Number(e.target.value))} className="w-full" />
              <span className="text-xs text-sdm-muted">{multiEnsembleMinTss.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-sdm-text">
              <input type="checkbox" checked={multiEnsembleExport} onChange={(e) => onMultiEnsembleExportChange(e.target.checked)} />
              Export individual model rasters
            </label>
            <label className="flex items-center gap-2 text-sm text-sdm-text">
              <input type="checkbox" checked={multiEnsembleUncertainty} onChange={(e) => onMultiEnsembleUncertaintyChange(e.target.checked)} />
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
                <input type="checkbox" className="sr-only" checked={biomod2Models.includes(a)} onChange={() => onToggleBiomod2Model(a)} />
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
              <input type="number" value={esmNRuns} onChange={(e) => onEsmNRunsChange(Number(e.target.value))} min={2} max={100} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">Data split (%)</label>
              <input type="number" value={esmSplit} onChange={(e) => onEsmSplitChange(Number(e.target.value))} min={50} max={90} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Weighting metric
              </label>
              <select value={esmWeightingMetric} onChange={(e) => onEsmWeightingMetricChange(e.target.value as typeof esmWeightingMetric)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value="AUC">AUC</option>
                <option value="TSS">TSS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Weighting power ({esmPower})
                <TooltipInfo content="Weight power. Higher values exaggerate weight differences between top and weak bivariate models." />
              </label>
              <input type="range" min={0.5} max={5} step={0.5} value={esmPower} onChange={(e) => onEsmPowerChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Min AUC filter
                <TooltipInfo content="Bivariate models below this AUC are dropped. Higher = more conservative ensemble." />
              </label>
              <input type="range" min={0.5} max={1} step={0.05} value={esmMinAuc} onChange={(e) => onEsmMinAucChange(Number(e.target.value))} className="w-full" />
              <span className="text-xs text-sdm-muted">{esmMinAuc.toFixed(2)}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                BIO variable subset
                <TooltipInfo content="Subset of BIO variables for ESM bivariate models. Default = same as main model." />
              </label>
              <select value={esmBiovars ? "custom" : "all"} onChange={(e) => onEsmBiovarsChange(e.target.value === "all" ? undefined : biovars)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value="all">Same as main model</option>
                <option value="custom">Use main biovars</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {isRangebag && (
        <div className="space-y-3 rounded-md border border-sdm-border/50 bg-sdm-surface-soft p-3">
          <p className="text-xs font-semibold text-sdm-heading uppercase tracking-wide">Rangebag settings</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Bags ({rangebagNBags})
                <TooltipInfo content="Number of bootstrap bags. More = more stable but slower. Default 100." />
              </label>
              <input type="range" min={10} max={500} step={10} value={rangebagNBags} onChange={(e) => onRangebagNBagsChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Bag fraction ({rangebagBagFraction.toFixed(2)})
                <TooltipInfo content="Fraction of presence records per bag. Lower = more diversity, less overfitting." />
              </label>
              <input type="range" min={0.1} max={1} step={0.05} value={rangebagBagFraction} onChange={(e) => onRangebagBagFractionChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Vars per bag ({rangebagVarsPerBag})
                <TooltipInfo content="Random covariates per bag. Fewer = more regularization, less overfitting." />
              </label>
              <input type="range" min={1} max={20} step={1} value={rangebagVarsPerBag} onChange={(e) => onRangebagVarsPerBagChange(Number(e.target.value))} className="w-full" />
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
              <input type="range" min={100} max={2000} step={100} value={rfNumTrees} onChange={(e) => onRfNumTreesChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Mtry (blank = auto)
                <TooltipInfo content="Covariates sampled per split. Lower = more regularization. Auto (sqrt) is usually optimal." />
              </label>
              <input type="number" value={rfMtry ?? ""} onChange={(e) => onRfMtryChange(e.target.value ? Number(e.target.value) : undefined)} min={1} max={50} placeholder="auto" className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Min node size ({rfMinNodeSize})
                <TooltipInfo content="Minimum data points per leaf node. Larger = simpler trees, less overfitting. Default 10." />
              </label>
              <input type="range" min={1} max={100} step={5} value={rfMinNodeSize} onChange={(e) => onRfMinNodeSizeChange(Number(e.target.value))} className="w-full" />
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
              <input type="range" min={3} max={15} step={1} value={gamK} onChange={(e) => onGamKChange(Number(e.target.value))} className="w-full" />
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
              <input type="range" min={3} max={12} step={1} value={xgbMaxDepth} onChange={(e) => onXgbMaxDepthChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Learning rate ({xgbEta})
                <TooltipInfo content="Learning rate. Lower = more robust but needs more rounds. 0.3 is standard; reduce to 0.1-0.01 with more rounds." />
              </label>
              <input type="number" min={0.01} max={0.5} step={0.01} value={xgbEta} onChange={(e) => onXgbEtaChange(Number(e.target.value))} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Boosting rounds ({xgbNRounds})
                <TooltipInfo content="Boosting rounds. More = better fit but risk of overfitting. Pair with early stopping." />
              </label>
              <input type="range" min={50} max={500} step={50} value={xgbNRounds} onChange={(e) => onXgbNRoundsChange(Number(e.target.value))} className="w-full" />
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
              <select value={dnnArchitecture} onChange={(e) => onDnnArchitectureChange(e.target.value as typeof dnnArchitecture)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
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
              <input type="range" min={0} max={0.5} step={0.05} value={dnnDropout} onChange={(e) => onDnnDropoutChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                L2 lambda
                <TooltipInfo content="L2 weight decay penalty. Higher = stronger regularization. 0.001 is standard." />
              </label>
              <input type="number" min={0.0001} max={0.1} step={0.0001} value={dnnL2Lambda} onChange={(e) => onDnnL2LambdaChange(Number(e.target.value))} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Seeds ({dnnNSeeds})
                <TooltipInfo content="Number of independent training runs. More seeds = more robust ensemble but slower. 5 is standard." />
              </label>
              <input type="range" min={1} max={20} step={1} value={dnnNSeeds} onChange={(e) => onDnnNSeedsChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Device
                <TooltipInfo content="GPU acceleration requires an NVIDIA GPU with CUDA. 'auto' uses GPU if available, falls back to CPU otherwise." />
              </label>
              <select value={dnnDevice} onChange={(e) => onDnnDeviceChange(e.target.value as typeof dnnDevice)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value="auto">Auto (GPU if available)</option>
                <option value="gpu">GPU (CUDA)</option>
                <option value="cpu">CPU only</option>
              </select>
            </div>
            <details className="border-t border-sdm-border/50 pt-3">
              <summary className="text-xs font-semibold text-sdm-heading uppercase tracking-wide cursor-pointer">
                Experimental
              </summary>
              <div className="mt-2">
                <label className="block text-xs font-medium text-sdm-muted mb-1">
                  Fused Adam optimizer
                </label>
                <select
                  value={dnnFusedAdam}
                  onChange={(e) => onDnnFusedAdamChange(e.target.value as "auto" | "always" | "off")}
                  className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text"
                >
                  <option value="auto">Auto (GPU only)</option>
                  <option value="always">Always (GPU + CPU)</option>
                  <option value="off">Off (standard Adam)</option>
                </select>
              </div>
            </details>
          </div>
        </details>
      )}

      {modelId === "dnn_multispecies" && (
        <details className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sdm-heading uppercase tracking-wide">Multi-Species DNN tuning</summary>
          <div className="px-3 pb-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Architecture
                <TooltipInfo content="Hidden layer config. Small (64) for under 250 records, Medium (100-100) for most cases, Large (100-100-100) for over 1000 records." />
              </label>
              <select value={dnnMultispeciesArchitecture} onChange={(e) => onDnnMultispeciesArchitectureChange(e.target.value as typeof dnnMultispeciesArchitecture)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value="DNN_Small">DNN Small (64 units, 1 layer)</option>
                <option value="DNN_Medium">DNN Medium (100-100, 2 layers)</option>
                <option value="DNN_Large">DNN Large (100-100-100, 3 layers)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Seeds ({dnnMultispeciesNSeeds})
                <TooltipInfo content="Number of independent training runs. More seeds = more robust ensemble but slower. 3 is standard for multi-species." />
              </label>
              <input type="range" min={1} max={20} step={1} value={dnnMultispeciesNSeeds} onChange={(e) => onDnnMultispeciesNSeedsChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Device
                <TooltipInfo content="GPU acceleration requires an NVIDIA GPU with CUDA. 'auto' uses GPU if available, falls back to CPU otherwise." />
              </label>
              <select value={dnnDevice} onChange={(e) => onDnnDeviceChange(e.target.value as typeof dnnDevice)} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value="auto">Auto (GPU if available)</option>
                <option value="gpu">GPU (CUDA)</option>
                <option value="cpu">CPU only</option>
              </select>
            </div>
          </div>
        </details>
      )}

      {modelId === "gllvm" && (
        <details className="rounded-md border border-sdm-border/50 bg-sdm-surface-soft">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sdm-heading uppercase tracking-wide">gllvm JSDM tuning</summary>
          <div className="px-3 pb-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Family
                <TooltipInfo content="Response distribution. binomial for presence-absence, poisson for counts, negative.binomial for overdispersed counts." />
              </label>
              <select value={gllvmFamily} onChange={(e) => onGllvmFamilyChange(e.target.value as "binomial" | "poisson" | "negative.binomial")} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value="binomial">Binomial</option>
                <option value="poisson">Poisson</option>
                <option value="negative.binomial">Negative binomial</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Latent variables ({gllvmNumLv})
                <TooltipInfo content="Number of latent variables. More = captures more residual correlation. 2-3 is typical for most datasets." />
              </label>
              <input type="range" min={1} max={10} step={1} value={gllvmNumLv} onChange={(e) => onGllvmNumLvChange(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-sdm-muted mb-1">
                Row effect
                <TooltipInfo content="Row effect type. 0 = none, 1 = fixed, 2 = random. Fixed is generally recommended for presence-absence data." />
              </label>
              <select value={gllvmNumRows} onChange={(e) => onGllvmNumRowsChange(Number(e.target.value))} className="w-full rounded border border-sdm-border bg-sdm-surface px-2 py-1.5 text-sm text-sdm-text">
                <option value={0}>None</option>
                <option value={1}>Fixed</option>
                <option value={2}>Random</option>
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-sdm-muted">
                <input type="checkbox" checked={gllvmLvCorr} onChange={(e) => onGllvmLvCorrChange(e.target.checked)} />
                Latent variable correlation
                <TooltipInfo content="If enabled, estimates correlation between latent variables. More flexible but slower to fit." />
              </label>
            </div>
          </div>
        </details>
      )}

      <details className="rounded-lg border border-sdm-border bg-sdm-surface">
        <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-sdm-heading">Optional covariates</summary>
        <div className="px-6 pb-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useElevation} onChange={(e) => onUseElevationChange(e.target.checked)} />
              Add elevation (OpenTopography)
            </label>
            {useElevation && (
              <>
                <select
                  value={elevationDemtype}
                  onChange={(e) => onElevationDemtypeChange(e.target.value)}
                  className="ml-2 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text"
                >
                  {["COP90", "COP30", "SRTMGL3", "SRTMGL1", "NASADEM", "AW3D30"].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {demWarning && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-500">
                    <AlertTriangle className="h-3 w-3" /> {demWarning}
                  </span>
                )}
              </>
            )}
            {useElevation && (
              <div className="ml-6 mt-2">
                <label className="block text-xs font-medium text-sdm-muted mb-1">OpenTopography API key</label>
                <input type="password" value={opentopoApiKey} onChange={(e) => onOpentopoApiKeyChange(e.target.value)} placeholder="Optional but strongly recommended — all DEM types require API key" className="w-full max-w-xs rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1.5 text-xs text-sdm-text" />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useSoil} onChange={(e) => onUseSoilChange(e.target.checked)} />
            Add SoilGrids covariates
          </label>
          {useSoil && (
            <div className="space-y-2 ml-6">
              <div className="flex flex-wrap gap-2">
                {SOIL_VARS.map((v: { id: string; label: string }) => (
                  <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", soilVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" checked={soilVars.includes(v.id)} onChange={() => onToggleSoilVar(v.id)} className="sr-only" />
                    {v.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {SOIL_DEPTHS.map((d: string) => (
                  <label key={d} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", soilDepths.includes(d) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" checked={soilDepths.includes(d)} onChange={() => onToggleSoilDepth(d)} className="sr-only" />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useUv} onChange={(e) => onUseUvChange(e.target.checked)} />
            Add UV-B covariates (glUV)
            <TooltipInfo content="Select months for UV variables. Leave empty to load all months." />
          </label>
          {useUv && (
            <div className="flex flex-wrap gap-2 ml-6">
              {UV_VARS.map((v: { id: string; label: string }) => (
                <label key={v.id} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", uvVars.includes(v.id) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                  <input type="checkbox" checked={uvVars.includes(v.id)} onChange={() => onToggleUvVar(v.id)} className="sr-only" />
                  {v.label}
                </label>
              ))}
              <div className="flex flex-wrap gap-2 mt-2">
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month) => (
                  <label key={month} className={cn("px-2 py-1 rounded text-xs cursor-pointer border", uvMonths.includes(month) ? "border-sdm-accent bg-sdm-accent/10 text-sdm-accent" : "border-sdm-border text-sdm-muted")}>
                    <input type="checkbox" className="sr-only" checked={uvMonths.includes(month)} onChange={() => onUvMonthsChange(uvMonths.includes(month) ? uvMonths.filter((x) => x !== month) : [...uvMonths, month])} />
                    {month.slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useVegetation} onChange={(e) => onUseVegetationChange(e.target.checked)} />
              Add vegetation productivity
            </label>
            {useVegetation && (
              <div className="flex items-center gap-2 ml-2">
                <select value={vegProduct} onChange={(e) => onVegProductChange(e.target.value)} className="rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                  {["ndvi_annual_mean", "evi_annual_mean", "fc_overall", "fpar_mean", "lai_mean", "gpp_mean", "ndvi_peak", "ndvi_min"].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <input type="number" value={vegYear ?? ""} onChange={(e) => onVegYearChange(e.target.value ? Number(e.target.value) : undefined)} placeholder="Year" min={2000} max={2025} className="w-20 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-sdm-text flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useLulc} onChange={(e) => onUseLulcChange(e.target.checked)} />
              Add LULC (MODIS)
            </label>
            {useLulc && (
              <select value={lulcYear} onChange={(e) => onLulcYearChange(Number(e.target.value))} className="ml-2 rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                {[2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useHfp} onChange={(e) => onUseHfpChange(e.target.checked)} />
            Add Human Footprint
          </label>
          {useHfp && (
            <div className="ml-6">
              <label className="block text-xs font-medium text-sdm-muted mb-1">Year</label>
              <select value={hfpYear} onChange={(e) => onHfpYearChange(Number(e.target.value))} className="rounded border border-sdm-border bg-sdm-surface-soft px-2 py-1 text-xs text-sdm-text">
                {[2000, 2005, 2010, 2015, 2020].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useBioclimSeason} onChange={(e) => onUseBioclimSeasonChange(e.target.checked)} />
            Add bioclimatic seasonality
          </label>
          <label className="flex items-center gap-2 text-sm text-sdm-text">
            <input type="checkbox" checked={useDrought} onChange={(e) => onUseDroughtChange(e.target.checked)} />
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
                    <input type="checkbox" className="sr-only" checked={droughtPeriods.includes(p.id)} onChange={() => onDroughtPeriodsChange(droughtPeriods.includes(p.id) ? droughtPeriods.filter((x) => x !== p.id) : [...droughtPeriods, p.id])} />
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
              <input type="checkbox" checked={vifReduction} onChange={(e) => onVifReductionChange(e.target.checked)} />
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
                  onChange={(e) => onVifThresholdChange(Number(e.target.value))}
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
            <select value={biasMethod} onChange={(e) => onBiasMethodChange(e.target.value as typeof biasMethod)} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text">
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
              <input type="number" value={thickeningDistanceKm} onChange={(e) => onThickeningDistanceKmChange(Number(e.target.value))} min={1} max={100} className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text" />
            </div>
          )}

          <div className="pt-2 border-t border-sdm-border/50 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-sdm-heading mb-2">Climate matching</h4>
              <p className="text-xs text-sdm-muted mb-2">
                Computes environmental similarity (MESS) between training and projection areas. Helps detect
                extrapolation beyond the climate range used for model training.
              </p>
              <label className="flex items-center gap-2 text-sm text-sdm-text mb-2">
                <input type="checkbox" checked={climateMatching} onChange={(e) => onClimateMatchingChange(e.target.checked)} />
                Compute climate matching
              </label>
              {climateMatching && (
                <div>
                  <label className="block text-xs font-medium text-sdm-muted mb-1">Distance method</label>
                  <select
                    value={climateMatchingMethod}
                    onChange={(e) => onClimateMatchingMethodChange(e.target.value as typeof climateMatchingMethod)}
                    className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text"
                  >
                    <option value="mahalanobis">Mahalanobis (multivariate, recommended)</option>
                    <option value="standardised">Standardised Euclidean</option>
                    <option value="euclidean">Raw Euclidean</option>
                  </select>
                </div>
              )}
            </div>
            <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-sdm-text">
              <input type="checkbox" checked={generateTiles} onChange={(e) => onGenerateTilesChange(e.target.checked)} />
              Pre-generate map tiles
              <TooltipInfo content="Generates tile PNGs eagerly for fastest map load. Uncheck to skip tile generation — tiles are served on-the-fly from COG but first load may be slower." />
            </label>
            <label className="flex items-center gap-2 text-sm text-sdm-text">
              <input type="checkbox" checked={generateCog} onChange={(e) => onGenerateCogChange(e.target.checked)} />
              Generate COG raster
              <TooltipInfo content="Creates a Cloud-Optimized GeoTIFF in EPSG:3857 for fast tile serving. Disable to save disk space and build time — tiles are generated on-the-fly from the source GeoTIFF." />
            </label>
          </div>
        </div>
      </div>
      </details>
    </>
  );
}
