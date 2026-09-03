import { describe, it, expect } from "vitest";
import { getMapColors } from "./map-theme";

describe("getMapColors", () => {
  it("returns dark palette when theme is dark", () => {
    const colors = getMapColors("dark");
    expect(colors.eooFill).toBe("#818cf8");
    expect(colors.aooFill).toBe("#fbbf24");
    expect(colors.extentOutline).toBe("#60a5fa");
    expect(colors.boundaryFill).toBe("#06b6d4");
    expect(colors.suitabilityMask).toBe("#1b2030");
  });

  it("returns light palette when theme is light", () => {
    const colors = getMapColors("light");
    expect(colors.eooFill).toBe("#6366f1");
    expect(colors.aooFill).toBe("#f59e0b");
    expect(colors.extentOutline).toBe("#2563eb");
    expect(colors.boundaryFill).toBe("#06b6d4");
    expect(colors.suitabilityMask).toBe("#f2efe9");
  });

  it("dark palette has all required keys", () => {
    const colors = getMapColors("dark");
    expect(colors).toHaveProperty("eooFill");
    expect(colors).toHaveProperty("eooFillOpacity");
    expect(colors).toHaveProperty("eooOutline");
    expect(colors).toHaveProperty("eooOutlineOpacity");
    expect(colors).toHaveProperty("aooFill");
    expect(colors).toHaveProperty("aooFillOpacity");
    expect(colors).toHaveProperty("aooOutline");
    expect(colors).toHaveProperty("aooOutlineOpacity");
    expect(colors).toHaveProperty("extentOutline");
    expect(colors).toHaveProperty("extentOutlineOpacity");
    expect(colors).toHaveProperty("extentDashArray");
    expect(colors).toHaveProperty("boundaryFill");
    expect(colors).toHaveProperty("boundaryFillOpacity");
    expect(colors).toHaveProperty("boundaryOutline");
    expect(colors).toHaveProperty("boundaryOutlineOpacity");
    expect(colors).toHaveProperty("suitabilityMask");
  });

  it("light palette has all required keys", () => {
    const colors = getMapColors("light");
    expect(colors).toHaveProperty("eooFill");
    expect(colors).toHaveProperty("eooFillOpacity");
    expect(colors).toHaveProperty("aooFill");
    expect(colors).toHaveProperty("boundaryFill");
    expect(colors).toHaveProperty("extentOutline");
    expect(colors).toHaveProperty("suitabilityMask");
  });

  it("all opacity values are between 0 and 1", () => {
    const dark = getMapColors("dark");
    const light = getMapColors("light");
    const all = [dark, light];
    for (const colors of all) {
      expect(colors.eooFillOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.eooFillOpacity).toBeLessThanOrEqual(1);
      expect(colors.eooOutlineOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.eooOutlineOpacity).toBeLessThanOrEqual(1);
      expect(colors.aooFillOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.aooFillOpacity).toBeLessThanOrEqual(1);
      expect(colors.aooOutlineOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.aooOutlineOpacity).toBeLessThanOrEqual(1);
      expect(colors.extentOutlineOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.extentOutlineOpacity).toBeLessThanOrEqual(1);
      expect(colors.boundaryFillOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.boundaryFillOpacity).toBeLessThanOrEqual(1);
      expect(colors.boundaryOutlineOpacity).toBeGreaterThanOrEqual(0);
      expect(colors.boundaryOutlineOpacity).toBeLessThanOrEqual(1);
    }
  });

  it("extentDashArray is an array of numbers", () => {
    const dark = getMapColors("dark");
    expect(Array.isArray(dark.extentDashArray)).toBe(true);
    expect(dark.extentDashArray.length).toBeGreaterThan(0);
    for (const n of dark.extentDashArray) {
      expect(typeof n).toBe("number");
    }
  });

  it("dark and light palettes differ", () => {
    const dark = getMapColors("dark");
    const light = getMapColors("light");
    expect(dark.eooFill).not.toBe(light.eooFill);
    expect(dark.aooFill).not.toBe(light.aooFill);
  });
});
