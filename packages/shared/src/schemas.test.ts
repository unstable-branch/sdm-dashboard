import { describe, it, expect } from "vitest";
import { modelConfigSchema } from "./schemas.js";

const validMinimal = {
  species: "Test species",
  modelId: "glm",
  biovars: [1, 4, 6],
  projectionExtent: [-180, 180, -90, 90],
  occurrenceFile: "/data/occurrences.csv",
};

const validFull = {
  species: "Test species",
  speciesFilter: "Filtered species",
  modelId: "multi_ensemble",
  biovars: [1, 4, 6, 12, 18],
  projectionExtent: [-170, 175, -85, 85],
  trainingExtent: [-180, 180, -90, 90],
  backgroundN: 50000,
  cvFolds: 5,
  cvStrategy: "spatial_blocks",
  cvBlockSizeKm: 100,
  threshold: 0.7,
  generateTiles: true,
  generateCog: false,
  maskType: "landmass",
  maskFile: "/data/mask.tif",
  maskBufferDeg: 0.5,
  maskBoundaryType: "admin0",
  maskResolution: "10m",
  maskCountry: "all",
  restrictBackground: true,
  includeQuadratic: true,
  useElevation: true,
  elevationDemtype: "COP90",
  opentopoApiKey: "key-123",
  useSoil: true,
  soilVars: ["sand", "clay", "silt"],
  soilDepths: ["0-5cm", "30-60cm", "60-100cm"],
  useUv: true,
  uvVars: ["UVB1", "UVB2", "UVB3"],
  useVegetation: true,
  vegYear: 2020,
  vegProducts: ["ndvi_annual_mean", "evi_annual_mean"],
  useLulc: true,
  lulcYear: 2020,
  useHfp: true,
  hfpYear: 2015,
  useBioclimSeason: true,
  useDrought: true,
  futureProjection: true,
  futureWorldclimDir: "/data/future",
  futureLabel: "Future 2050",
  futureProjection2: true,
  futureWorldclimDir2: "/data/future2",
  futureLabel2: "Future 2070",
  vifReduction: true,
  vifThreshold: 5,
  climateMatching: true,
  climateMatchingMethod: "euclidean",
  extrapolationMask: true,
  messThreshold: 5,
  thinByCell: false,
  mergeSmallSources: false,
  minSourceRecords: 10,
  biasMethod: "target_group",
  thickeningDistanceKm: 50,
  targetGroupFile: "/data/target.csv",
  paReplicates: 3,
  maxnetFeatures: "lqpht",
  maxnetRegmult: 2.5,
  dnnArchitecture: "DNN_Large",
  dnnNSeeds: 10,
  dnnDevice: "gpu",
  brtNTrees: 5000,
  brtInteractionDepth: 5,
  brtShrinkage: 0.05,
  brtBagFraction: 0.8,
  ctaCp: 0.05,
  ctaMaxdepth: 15,
  ctaMinsplit: 30,
  marsDegree: 3,
  marsPenalty: 5,
  fdaDegree: 4,
  annSize: 10,
  annDecay: 0.1,
  annMaxit: 500,
  annRang: 2,
  marsNk: 10,
  fdaNprune: 20,
  rfNumTrees: 1000,
  rfMtry: 10,
  rfMinNodeSize: 5,
  xgbMaxDepth: 10,
  xgbEta: 0.5,
  xgbNRounds: 200,
  bartNtree: 500,
  bartNdpost: 2000,
  bartNskip: 1000,
  brmsChains: 6,
  brmsIter: 4000,
  brmsWarmup: 2000,
  inlaMeshMaxEdge: 0.5,
  inlaMeshCutoff: 0.1,
  inlaPriorRange: 50,
  inlaPriorSigma: 10,
  multiEnsembleModels: ["rf", "maxnet", "glm"],
  multiEnsembleBiomod2: ["Biomod2", "Biomod2_maxent"],
  multiEnsembleWeighting: "tss",
  multiEnsemblePower: 3,
  multiEnsembleMinAuc: 0.8,
  multiEnsembleMinTss: 0.7,
  rangebagNBags: 500,
  rangebagBagFraction: 0.7,
  rangebagVarsPerBag: 3,
  maxnetAutoTune: true,
  gamK: 10,
  dnnDropout: 0.4,
  dnnL2Lambda: 0.01,
  detectionFormula: "~1",
  detectionModelType: "occuRN",
  dnnMultispeciesArchitecture: "DNN_Large",
  dnnMultispeciesNSeeds: 5,
  aggregationFactor: 2,
  nCores: 8,
  seed: 123,
  occurrenceFile: "/data/occurrences.csv",
  worldclimDir: "Worldclim",
  worldclimRes: 10,
  source: "chelsa",
  analysisCrs: "EPSG:4326",
  chelsaExtras: ["gdd5", "gsl"],
  cleanedFilePath: "/data/cleaned.csv",
  multiEnsembleExport: true,
  multiEnsembleUncertainty: true,
  biomod2Models: ["Biomod2", "Biomod2_maxent"],
  esmNRuns: 10,
  esmSplit: 80,
  esmMinAuc: 0.8,
  esmPower: 2,
  esmWeightingMetric: "TSS",
  esmBiovars: [1, 4, 6],
  uvMonths: ["annual_mean", "seasonal"],
  droughtPeriods: ["annual_mean", "summer"],
};

describe("modelConfigSchema", () => {
  describe("valid configs", () => {
    it("accepts minimal valid config", () => {
      const result = modelConfigSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts full config with all model backends", () => {
      const result = modelConfigSchema.safeParse(validFull);
      expect(result.success).toBe(true);
    });
  });

  describe("missing required fields", () => {
    it("rejects missing species", () => {
      const { species, ...rest } = validMinimal;
      const result = modelConfigSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing modelId", () => {
      const { modelId, ...rest } = validMinimal;
      const result = modelConfigSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing biovars", () => {
      const { biovars, ...rest } = validMinimal;
      const result = modelConfigSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing projectionExtent", () => {
      const { projectionExtent, ...rest } = validMinimal;
      const result = modelConfigSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing occurrenceFile", () => {
      const { occurrenceFile, ...rest } = validMinimal;
      const result = modelConfigSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  describe("wrong types", () => {
    it("rejects string in place of number for backgroundN", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, backgroundN: "ten thousand" });
      expect(result.success).toBe(false);
    });

    it("rejects string in place of number for cvFolds", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, cvFolds: "five" });
      expect(result.success).toBe(false);
    });

    it("rejects string in place of number for threshold", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, threshold: "half" });
      expect(result.success).toBe(false);
    });

    it("rejects string in place of number array for biovars", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: "1,4,6" });
      expect(result.success).toBe(false);
    });

    it("rejects number for boolean field generateTiles", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, generateTiles: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("biovars validation", () => {
    it("rejects biovars with value 0 (below min)", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [0, 4, 6] });
      expect(result.success).toBe(false);
    });

    it("rejects biovars with value 20 (above max)", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [1, 4, 20] });
      expect(result.success).toBe(false);
    });

    it("rejects biovars with fewer than 2 elements", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [1] });
      expect(result.success).toBe(false);
    });

    it("accepts biovars with exactly 2 elements", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [1, 19] });
      expect(result.success).toBe(true);
    });

    it("accepts biovars with 19 elements", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] });
      expect(result.success).toBe(true);
    });

    it("rejects biovars with non-integer values", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [1.5, 4, 6] });
      expect(result.success).toBe(false);
    });
  });

  describe("extent validation", () => {
    it("rejects projectionExtent where xmin > xmax", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, projectionExtent: [180, -180, -90, 90] });
      expect(result.success).toBe(false);
    });

    it("rejects projectionExtent where ymin > ymax", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, projectionExtent: [-180, 180, 90, -90] });
      expect(result.success).toBe(false);
    });

    it("rejects projectionExtent with x coordinate below -180", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, projectionExtent: [-181, 180, -90, 90] });
      expect(result.success).toBe(false);
    });

    it("rejects projectionExtent with x coordinate above 180", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, projectionExtent: [-180, 181, -90, 90] });
      expect(result.success).toBe(false);
    });

    it("rejects projectionExtent with y coordinate below -90", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, projectionExtent: [-180, 180, -91, 90] });
      expect(result.success).toBe(false);
    });

    it("rejects projectionExtent with y coordinate above 90", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, projectionExtent: [-180, 180, -90, 91] });
      expect(result.success).toBe(false);
    });
  });

  describe("cvFolds validation", () => {
    it("rejects negative cvFolds", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, cvFolds: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects cvFolds above 10", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, cvFolds: 11 });
      expect(result.success).toBe(false);
    });
  });

  describe("default values", () => {
    it("applies default backgroundN (10000)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.backgroundN).toBe(10000);
    });

    it("applies default cvFolds (3)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.cvFolds).toBe(3);
    });

    it("applies default cvStrategy (random)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.cvStrategy).toBe("random");
    });

    it("applies default threshold (0.5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.threshold).toBe(0.5);
    });

    it("applies default generateTiles (true)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.generateTiles).toBe(true);
    });

    it("applies default generateCog (true)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.generateCog).toBe(true);
    });

    it("applies default maskType (none)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maskType).toBe("none");
    });

    it("applies default maskBoundaryType (admin0)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maskBoundaryType).toBe("admin0");
    });

    it("applies default maskResolution (auto)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maskResolution).toBe("auto");
    });

    it("applies default maskCountry (all)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maskCountry).toBe("all");
    });

    it("applies default restrictBackground (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.restrictBackground).toBe(false);
    });

    it("applies default includeQuadratic (true)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.includeQuadratic).toBe(true);
    });

    it("applies default useElevation (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useElevation).toBe(false);
    });

    it("applies default elevationDemtype (COP90)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.elevationDemtype).toBe("COP90");
    });

    it("applies default useSoil (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useSoil).toBe(false);
    });

    it("applies default soilVars", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.soilVars).toEqual(["sand", "clay", "phh2o"]);
    });

    it("applies default soilDepths", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.soilDepths).toEqual(["0-5cm", "30-60cm"]);
    });

    it("applies default useUv (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useUv).toBe(false);
    });

    it("applies default uvVars", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.uvVars).toEqual(["UVB1", "UVB2"]);
    });

    it("applies default useVegetation (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useVegetation).toBe(false);
    });

    it("applies default vegProducts", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.vegProducts).toEqual(["ndvi_annual_mean"]);
    });

    it("applies default useLulc (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useLulc).toBe(false);
    });

    it("applies default lulcYear (2020)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.lulcYear).toBe(2020);
    });

    it("applies default useHfp (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useHfp).toBe(false);
    });

    it("applies default hfpYear (2020)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.hfpYear).toBe(2020);
    });

    it("applies default useBioclimSeason (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useBioclimSeason).toBe(false);
    });

    it("applies default useDrought (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.useDrought).toBe(false);
    });

    it("applies default futureProjection (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.futureProjection).toBe(false);
    });

    it("applies default futureLabel", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.futureLabel).toBe("Future climate");
    });

    it("applies default vifReduction (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.vifReduction).toBe(false);
    });

    it("applies default vifThreshold (10)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.vifThreshold).toBe(10);
    });

    it("applies default climateMatching (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.climateMatching).toBe(false);
    });

    it("applies default climateMatchingMethod (mahalanobis)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.climateMatchingMethod).toBe("mahalanobis");
    });

    it("applies default extrapolationMask (true)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.extrapolationMask).toBe(true);
    });

    it("applies default messThreshold (0)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.messThreshold).toBe(0);
    });

    it("applies default thinByCell (true)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.thinByCell).toBe(true);
    });

    it("applies default mergeSmallSources (true)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.mergeSmallSources).toBe(true);
    });

    it("applies default minSourceRecords (15)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.minSourceRecords).toBe(15);
    });

    it("applies default biasMethod (uniform)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.biasMethod).toBe("uniform");
    });

    it("applies default thickeningDistanceKm (10)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.thickeningDistanceKm).toBe(10);
    });

    it("applies default paReplicates (1)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.paReplicates).toBe(1);
    });

    it("applies default maxnetFeatures (lqp)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maxnetFeatures).toBe("lqp");
    });

    it("applies default maxnetRegmult (1)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maxnetRegmult).toBe(1);
    });

    it("applies default dnnArchitecture (DNN_Medium)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnArchitecture).toBe("DNN_Medium");
    });

    it("applies default dnnNSeeds (5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnNSeeds).toBe(5);
    });

    it("applies default dnnDevice (auto)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnDevice).toBe("auto");
    });

    it("applies default brtNTrees (2000)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brtNTrees).toBe(2000);
    });

    it("applies default brtInteractionDepth (3)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brtInteractionDepth).toBe(3);
    });

    it("applies default brtShrinkage (0.01)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brtShrinkage).toBe(0.01);
    });

    it("applies default brtBagFraction (0.75)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brtBagFraction).toBe(0.75);
    });

    it("applies default ctaCp (0.01)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.ctaCp).toBe(0.01);
    });

    it("applies default ctaMaxdepth (10)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.ctaMaxdepth).toBe(10);
    });

    it("applies default ctaMinsplit (20)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.ctaMinsplit).toBe(20);
    });

    it("applies default marsDegree (2)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.marsDegree).toBe(2);
    });

    it("applies default marsPenalty (3)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.marsPenalty).toBe(3);
    });

    it("applies default fdaDegree (2)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.fdaDegree).toBe(2);
    });

    it("applies default annSize (5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.annSize).toBe(5);
    });

    it("applies default annDecay (0.01)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.annDecay).toBe(0.01);
    });

    it("applies default annMaxit (200)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.annMaxit).toBe(200);
    });

    it("applies default annRang (0.5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.annRang).toBe(0.5);
    });

    it("applies default rfNumTrees (500)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.rfNumTrees).toBe(500);
    });

    it("applies default rfMinNodeSize (10)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.rfMinNodeSize).toBe(10);
    });

    it("applies default xgbMaxDepth (6)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.xgbMaxDepth).toBe(6);
    });

    it("applies default xgbEta (0.3)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.xgbEta).toBe(0.3);
    });

    it("applies default xgbNRounds (100)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.xgbNRounds).toBe(100);
    });

    it("applies default bartNtree (200)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.bartNtree).toBe(200);
    });

    it("applies default bartNdpost (1000)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.bartNdpost).toBe(1000);
    });

    it("applies default bartNskip (500)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.bartNskip).toBe(500);
    });

    it("applies default brmsChains (4)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brmsChains).toBe(4);
    });

    it("applies default brmsIter (2000)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brmsIter).toBe(2000);
    });

    it("applies default brmsWarmup (1000)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.brmsWarmup).toBe(1000);
    });

    it("applies default multiEnsembleWeighting (auc)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.multiEnsembleWeighting).toBe("auc");
    });

    it("applies default multiEnsemblePower (2)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.multiEnsemblePower).toBe(2);
    });

    it("applies default multiEnsembleMinAuc (0.7)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.multiEnsembleMinAuc).toBe(0.7);
    });

    it("applies default multiEnsembleMinTss (0.5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.multiEnsembleMinTss).toBe(0.5);
    });

    it("applies default rangebagNBags (100)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.rangebagNBags).toBe(100);
    });

    it("applies default rangebagBagFraction (0.5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.rangebagBagFraction).toBe(0.5);
    });

    it("applies default rangebagVarsPerBag (1)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.rangebagVarsPerBag).toBe(1);
    });

    it("applies default maxnetAutoTune (false)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.maxnetAutoTune).toBe(false);
    });

    it("applies default gamK (5)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.gamK).toBe(5);
    });

    it("applies default dnnDropout (0.3)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnDropout).toBe(0.3);
    });

    it("applies default dnnL2Lambda (0.001)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnL2Lambda).toBe(0.001);
    });

    it("applies default detectionFormula (~1)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.detectionFormula).toBe("~1");
    });

    it("applies default detectionModelType (occu)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.detectionModelType).toBe("occu");
    });

    it("applies default dnnMultispeciesArchitecture (DNN_Medium)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnMultispeciesArchitecture).toBe("DNN_Medium");
    });

    it("applies default dnnMultispeciesNSeeds (3)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.dnnMultispeciesNSeeds).toBe(3);
    });

    it("applies default aggregationFactor (1)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.aggregationFactor).toBe(1);
    });

    it("applies default nCores (1)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.nCores).toBe(1);
    });

    it("applies default seed (42)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.seed).toBe(42);
    });

    it("applies default worldclimDir (Worldclim)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.worldclimDir).toBe("Worldclim");
    });

    it("applies default worldclimRes (10)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.worldclimRes).toBe(10);
    });

    it("applies default source (worldclim)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.source).toBe("worldclim");
    });

    it("applies default analysisCrs (auto)", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.analysisCrs).toBe("auto");
    });

    it("applies default chelsaExtras ([])", () => {
      const result = modelConfigSchema.parse(validMinimal);
      expect(result.chelsaExtras).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("rejects empty string for species", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, species: "" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string for modelId", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, modelId: "" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string for occurrenceFile", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, occurrenceFile: "" });
      expect(result.success).toBe(false);
    });

    it("rejects null for required fields", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, species: null });
      expect(result.success).toBe(false);
    });

    it("rejects undefined for required fields", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, species: undefined });
      expect(result.success).toBe(false);
    });

    it("rejects null for biovars", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: null });
      expect(result.success).toBe(false);
    });

    it("rejects empty biovars array", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biovars: [] });
      expect(result.success).toBe(false);
    });
  });

  describe("model backend parameters", () => {
    it("accepts maxnet parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "maxnet",
        maxnetFeatures: "lqpht",
        maxnetRegmult: 2,
        maxnetAutoTune: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts DNN parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "dnn",
        dnnArchitecture: "DNN_Small",
        dnnNSeeds: 3,
        dnnDevice: "cpu",
        dnnDropout: 0.2,
        dnnL2Lambda: 0.005,
        dnnMultispeciesArchitecture: "DNN_Small",
        dnnMultispeciesNSeeds: 2,
      });
      expect(result.success).toBe(true);
    });

    it("accepts BRT parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "brt",
        brtNTrees: 5000,
        brtInteractionDepth: 5,
        brtShrinkage: 0.05,
        brtBagFraction: 0.8,
      });
      expect(result.success).toBe(true);
    });

    it("accepts CTA parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "cta",
        ctaCp: 0.05,
        ctaMaxdepth: 20,
        ctaMinsplit: 50,
      });
      expect(result.success).toBe(true);
    });

    it("accepts MARS parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "mars",
        marsDegree: 4,
        marsPenalty: 5,
        marsNk: 20,
      });
      expect(result.success).toBe(true);
    });

    it("accepts FDA parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "fda",
        fdaDegree: 3,
        fdaNprune: 30,
      });
      expect(result.success).toBe(true);
    });

    it("accepts ANN parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "ann",
        annSize: 20,
        annDecay: 0.5,
        annMaxit: 500,
        annRang: 5,
      });
      expect(result.success).toBe(true);
    });

    it("accepts RF parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "rf",
        rfNumTrees: 1000,
        rfMtry: 20,
        rfMinNodeSize: 5,
      });
      expect(result.success).toBe(true);
    });

    it("accepts XGBoost parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "xgb",
        xgbMaxDepth: 10,
        xgbEta: 0.5,
        xgbNRounds: 200,
      });
      expect(result.success).toBe(true);
    });

    it("accepts BART parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "bart",
        bartNtree: 500,
        bartNdpost: 2000,
        bartNskip: 1000,
      });
      expect(result.success).toBe(true);
    });

    it("accepts brms parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "brms",
        brmsChains: 6,
        brmsIter: 4000,
        brmsWarmup: 2000,
      });
      expect(result.success).toBe(true);
    });

    it("accepts INLA parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "inla",
        inlaMeshMaxEdge: 0.5,
        inlaMeshCutoff: 0.1,
        inlaPriorRange: 50,
        inlaPriorSigma: 10,
      });
      expect(result.success).toBe(true);
    });

    it("accepts multi_ensemble parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "multi_ensemble",
        multiEnsembleModels: ["rf", "maxnet", "glm"],
        multiEnsembleBiomod2: ["Biomod2", "Biomod2_maxent"],
        multiEnsembleWeighting: "auc",
        multiEnsemblePower: 3,
        multiEnsembleMinAuc: 0.8,
        multiEnsembleMinTss: 0.7,
        multiEnsembleExport: true,
        multiEnsembleUncertainty: true,
        biomod2Models: ["Biomod2"],
        esmNRuns: 10,
        esmWeightingMetric: "TSS",
      });
      expect(result.success).toBe(true);
    });

    it("accepts rangebag parameters", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "rangebag",
        rangebagNBags: 500,
        rangebagBagFraction: 0.7,
        rangebagVarsPerBag: 3,
      });
      expect(result.success).toBe(true);
    });

    it("accepts GLM parameters (gamK)", () => {
      const result = modelConfigSchema.safeParse({
        ...validMinimal,
        modelId: "glm",
        gamK: 10,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("enum validation", () => {
    it("rejects invalid cvStrategy", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, cvStrategy: "invalid" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid source", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, source: "invalid" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid maskType", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, maskType: "invalid" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid maxnetFeatures", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, maxnetFeatures: "invalid" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid climateMatchingMethod", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, climateMatchingMethod: "invalid" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid biasMethod", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, biasMethod: "invalid" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid multiEnsembleWeighting", () => {
      const result = modelConfigSchema.safeParse({ ...validMinimal, multiEnsembleWeighting: "invalid" });
      expect(result.success).toBe(false);
    });
  });
});
