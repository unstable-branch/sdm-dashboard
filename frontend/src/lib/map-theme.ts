/**
 * Color palette for MapLibre map layers.
 * Used to style EOO polygons, AOO grids, boundary polygons, and extent outlines
 * in both dark and light basemap themes.
 */
export interface MapThemeColors {
  suitabilityMask: string;
  eooFill: string;
  eooFillOpacity: number;
  eooOutline: string;
  eooOutlineOpacity: number;
  aooFill: string;
  aooFillOpacity: number;
  aooOutline: string;
  aooOutlineOpacity: number;
  extentOutline: string;
  extentOutlineOpacity: number;
  extentDashArray: number[];
  boundaryFill: string;
  boundaryFillOpacity: number;
  boundaryOutline: string;
  boundaryOutlineOpacity: number;
}

/**
 * Returns the color palette for map overlay layers.
 * @param theme - The active map theme: "dark" or "light"
 * @returns An object containing fill colors, outline colors, and opacity values
 *          for each overlay layer type (EOO, AOO, boundary, extent).
 */
export function getMapColors(theme: "dark" | "light"): MapThemeColors {
  if (theme === "dark") {
    return {
      suitabilityMask: "#1b2030",
      eooFill: "#818cf8",
      eooFillOpacity: 0.08,
      eooOutline: "#818cf8",
      eooOutlineOpacity: 0.8,
      aooFill: "#fbbf24",
      aooFillOpacity: 0.25,
      aooOutline: "#fbbf24",
      aooOutlineOpacity: 1,
      extentOutline: "#60a5fa",
      extentOutlineOpacity: 0.5,
      extentDashArray: [6, 3],
      boundaryFill: "#06b6d4",
      boundaryFillOpacity: 0.08,
      boundaryOutline: "#06b6d4",
      boundaryOutlineOpacity: 0.6,
    };
  }
  return {
    suitabilityMask: "#f2efe9",
    eooFill: "#6366f1",
    eooFillOpacity: 0.08,
    eooOutline: "#6366f1",
    eooOutlineOpacity: 0.8,
    aooFill: "#f59e0b",
    aooFillOpacity: 0.25,
    aooOutline: "#d97706",
    aooOutlineOpacity: 1,
    extentOutline: "#2563eb",
    extentOutlineOpacity: 0.5,
    extentDashArray: [6, 3],
    boundaryFill: "#06b6d4",
    boundaryFillOpacity: 0.08,
    boundaryOutline: "#06b6d4",
    boundaryOutlineOpacity: 0.6,
  };
}
