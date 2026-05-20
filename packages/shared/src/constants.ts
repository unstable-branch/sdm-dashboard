export const BIOVAR_CHOICES = [
  { id: 1, label: "BIO1", description: "Annual Mean Temperature" },
  { id: 2, label: "BIO2", description: "Mean Diurnal Range" },
  { id: 3, label: "BIO3", description: "Isothermality" },
  { id: 4, label: "BIO4", description: "Temperature Seasonality" },
  { id: 5, label: "BIO5", description: "Max Temperature of Warmest Month" },
  { id: 6, label: "BIO6", description: "Min Temperature of Coldest Month" },
  { id: 7, label: "BIO7", description: "Temperature Annual Range" },
  { id: 8, label: "BIO8", description: "Mean Temperature of Wettest Quarter" },
  { id: 9, label: "BIO9", description: "Mean Temperature of Driest Quarter" },
  { id: 10, label: "BIO10", description: "Mean Temperature of Warmest Quarter" },
  { id: 11, label: "BIO11", description: "Mean Temperature of Coldest Quarter" },
  { id: 12, label: "BIO12", description: "Annual Precipitation" },
  { id: 13, label: "BIO13", description: "Precipitation of Wettest Month" },
  { id: 14, label: "BIO14", description: "Precipitation of Driest Month" },
  { id: 15, label: "BIO15", description: "Precipitation Seasonality" },
  { id: 16, label: "BIO16", description: "Precipitation of Wettest Quarter" },
  { id: 17, label: "BIO17", description: "Precipitation of Driest Quarter" },
  { id: 18, label: "BIO18", description: "Precipitation of Warmest Quarter" },
  { id: 19, label: "BIO19", description: "Precipitation of Coldest Quarter" },
];

export const EXTENT_PRESETS: Record<string, [number, number, number, number]> = {
  aus_full: [112, 154, -44, -10],
  world: [-180, 180, -90, 90],
};

export const MODEL_BACKENDS = [
  { id: "glm", label: "GLM / Logistic regression", maturity: "stable" as const },
  { id: "gam", label: "GAM / Smooth response curves", maturity: "stable" as const },
  { id: "maxnet", label: "MaxEnt", maturity: "stable" as const },
  { id: "rf", label: "Random Forest", maturity: "stable" as const },
  { id: "xgboost", label: "XGBoost", maturity: "experimental" as const },
  { id: "rangebag", label: "Rangebagging", maturity: "experimental" as const },
];
