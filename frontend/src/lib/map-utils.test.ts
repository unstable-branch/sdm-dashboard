import { describe, it, expect } from "vitest";
import {
  DEFAULT_TILE_ZOOM_MIN,
  DEFAULT_TILE_ZOOM_MAX,
  LAYER_IDS,
  extentToZoom,
  extentToCoordinates,
  extentToViewState,
  parseTileZoom,
} from "./map-utils";

describe("map-utils constants", () => {
  it("DEFAULT_TILE_ZOOM_MIN is 2", () => {
    expect(DEFAULT_TILE_ZOOM_MIN).toBe(2);
  });

  it("DEFAULT_TILE_ZOOM_MAX is 10", () => {
    expect(DEFAULT_TILE_ZOOM_MAX).toBe(10);
  });

  it("LAYER_IDS has all required keys", () => {
    expect(LAYER_IDS).toHaveProperty("SUITABILITY");
    expect(LAYER_IDS).toHaveProperty("EOO");
    expect(LAYER_IDS).toHaveProperty("AOO");
    expect(LAYER_IDS).toHaveProperty("BOUNDARY");
    expect(LAYER_IDS).toHaveProperty("EXTENT");
  });

  it("LAYER_IDS values are lowercase strings", () => {
    for (const v of Object.values(LAYER_IDS)) {
      expect(typeof v).toBe("string");
      expect(v).toBe(v.toLowerCase());
    }
  });
});

describe("extentToZoom", () => {
  it("returns 3 for extent > 50 span", () => {
    expect(extentToZoom([-80, 80, -60, 60])).toBe(3);
  });

  it("returns 4 for extent 20-50 span", () => {
    expect(extentToZoom([-15, 10, -10, 10])).toBe(4);
  });

  it("returns 5 for extent 10-20 span", () => {
    expect(extentToZoom([-10, 5, -5, 5])).toBe(5);
  });

  it("returns 6 for extent 5-10 span", () => {
    expect(extentToZoom([-6, 2, -3, 3])).toBe(6);
  });

  it("returns 7 for extent <= 5 span", () => {
    expect(extentToZoom([-2, 2, -1, 1])).toBe(7);
  });

  it("uses max of xSpan and ySpan", () => {
    expect(extentToZoom([-3, 0, -2, 0])).toBe(7);
  });

  it("returns 3 when maxSpan > 50", () => {
    expect(extentToZoom([-80, 0, -60, 0])).toBe(3);
  });
});

describe("extentToCoordinates", () => {
  it("converts extent [xmin, xmax, ymin, ymax] to 4-corner coordinates", () => {
    const result = extentToCoordinates([10, 20, 30, 40]);
    expect(result).toEqual([
      [10, 40],
      [20, 40],
      [20, 30],
      [10, 30],
    ]);
  });

  it("returns undefined for null", () => {
    expect(extentToCoordinates(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extentToCoordinates(undefined)).toBeUndefined();
  });

  it("returns undefined when extent has fewer than 4 elements", () => {
    expect(extentToCoordinates([1, 2, 3])).toBeUndefined();
    expect(extentToCoordinates([])).toBeUndefined();
  });
});

describe("extentToViewState", () => {
  it("calculates center longitude and latitude", () => {
    const result = extentToViewState([10, 20, 30, 40]);
    expect(result?.longitude).toBe(15);
    expect(result?.latitude).toBe(35);
  });

  it("uses extentToZoom for zoom", () => {
    expect(extentToViewState([-80, 80, -60, 60])?.zoom).toBe(3);
  });

  it("returns undefined for null", () => {
    expect(extentToViewState(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extentToViewState(undefined)).toBeUndefined();
  });

  it("returns undefined when extent has fewer than 4 elements", () => {
    expect(extentToViewState([1, 2])).toBeUndefined();
  });
});

describe("parseTileZoom", () => {
  it("returns fallback for undefined", () => {
    expect(parseTileZoom(undefined, 5)).toBe(5);
  });

  it("returns fallback for null", () => {
    expect(parseTileZoom(null as unknown as undefined, 5)).toBe(5);
  });

  it("returns fallback for empty string", () => {
    expect(parseTileZoom("", 5)).toBe(5);
  });

  it("parses valid positive integer", () => {
    expect(parseTileZoom("8", 5)).toBe(8);
  });

  it("returns fallback for 0", () => {
    expect(parseTileZoom("0", 5)).toBe(5);
  });

  it("returns fallback for negative", () => {
    expect(parseTileZoom("-1", 5)).toBe(5);
  });

  it("returns fallback for > 20", () => {
    expect(parseTileZoom("21", 5)).toBe(5);
  });

  it("returns fallback for non-numeric string", () => {
    expect(parseTileZoom("abc", 5)).toBe(5);
  });

  it("parses integer part of decimal string", () => {
    expect(parseTileZoom("7.5", 5)).toBe(7);
  });
});
