import { describe, it, expect } from "vitest";
import {
  densifyLine,
  densifyPolygon,
  densifyGeoJSONFeature,
  geodesicDistanceKm,
  geodesicAreaKm2,
  geodesicBounds,
  subdivideExtent,
} from "./geodesic";

describe("densifyLine", () => {
  it("returns empty array for empty input", () => {
    expect(densifyLine([])).toEqual([]);
  });

  it("returns single point as-is", () => {
    expect(densifyLine([[0, 0]])).toEqual([[0, 0]]);
  });

  it("returns two points as-is when distance is below maxSegmentKm", () => {
    expect(densifyLine([[0, 0], [0.05, 0]], 10)).toEqual([
      [0, 0],
      [0.05, 0],
    ]);
  });

  it("densifies long segments", () => {
    const coords: [number, number][] = [
      [0, 0],
      [10, 0],
    ];
    const result = densifyLine(coords, 5);
    expect(result.length).toBeGreaterThan(2);
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1][0]).toBeCloseTo(10, 5);
    expect(result[result.length - 1][1]).toBeCloseTo(0, 5);
  });

  it("uses default maxSegmentKm of 10", () => {
    const short: [number, number][] = [[0, 0], [0.01, 0]];
    const result = densifyLine(short);
    expect(result).toEqual([
      [0, 0],
      [0.01, 0],
    ]);
  });
});

describe("densifyPolygon", () => {
  it("returns empty array for fewer than 3 points", () => {
    expect(densifyPolygon([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });

  it("closes an open polygon by appending the first point", () => {
    const open: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const result = densifyPolygon(open);
    expect(result[result.length - 1]).toEqual([0, 0]);
  });

  it("does not duplicate closing point if already closed", () => {
    const closed: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const result = densifyPolygon(closed);
    expect(result[result.length - 1]).toEqual([0, 0]);
    expect(result[result.length - 2]).not.toEqual([0, 0]);
  });
});

describe("densifyGeoJSONFeature", () => {
  it("returns feature unchanged if no geometry", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feature: GeoJSON.Feature = { type: "Feature", geometry: null } as any;
    const result = densifyGeoJSONFeature(feature);
    expect(result).toEqual(feature);
  });

  it("densifies a Polygon geometry", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: { id: 1 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    };
    const result = densifyGeoJSONFeature(feature, 5);
    expect(result.geometry.type).toBe("Polygon");
    expect((result.geometry as GeoJSON.Polygon).coordinates[0].length).toBeGreaterThan(5);
  });

  it("preserves feature properties after densification", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: { name: "test" },
      geometry: {
        type: "LineString",
        coordinates: [[0, 0], [5, 0], [10, 0]],
      },
    };
    const result = densifyGeoJSONFeature(feature);
    expect(result.properties).toEqual({ name: "test" });
  });

  it("densifies a MultiPolygon geometry", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [5, 0],
              [5, 5],
              [0, 5],
              [0, 0],
            ],
          ],
        ],
      },
    };
    const result = densifyGeoJSONFeature(feature, 3);
    expect(result.geometry.type).toBe("MultiPolygon");
  });

  it("densifies a LineString geometry", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [[0, 0], [10, 0]],
      },
    };
    const result = densifyGeoJSONFeature(feature, 5);
    expect(result.geometry.type).toBe("LineString");
    expect((result.geometry as GeoJSON.LineString).coordinates.length).toBeGreaterThan(2);
  });

  it("returns feature unchanged for unknown geometry type", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Point",
        coordinates: [0, 0],
      } as GeoJSON.Point,
    };
    const result = densifyGeoJSONFeature(feature);
    expect(result).toEqual(feature);
  });
});

describe("geodesicDistanceKm", () => {
  it("returns 0 for same point", () => {
    expect(geodesicDistanceKm([0, 0], [0, 0])).toBe(0);
  });

  it("returns positive distance for different points", () => {
    const dist = geodesicDistanceKm([0, 0], [1, 0]);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(200);
  });

  it("is symmetric", () => {
    const a = geodesicDistanceKm([0, 0], [10, 5]);
    const b = geodesicDistanceKm([10, 5], [0, 0]);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
});

describe("geodesicAreaKm2", () => {
  it("returns 0 for fewer than 3 points", () => {
    expect(geodesicAreaKm2([[0, 0], [1, 1]])).toBe(0);
  });

  it("returns positive area for valid polygon", () => {
    const area = geodesicAreaKm2([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(20000);
  });

  it("is consistent regardless of winding order", () => {
    const ccw = geodesicAreaKm2([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    const cw = geodesicAreaKm2([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
    expect(ccw).toBeCloseTo(cw, 5);
  });
});

describe("geodesicBounds", () => {
  it("returns [[0,0],[0,0]] for empty array", () => {
    expect(geodesicBounds([])).toEqual([[0, 0], [0, 0]]);
  });

  it("returns correct bounds for a single point", () => {
    const result = geodesicBounds([[10, 20]]);
    expect(result).toEqual([[10, 20], [10, 20]]);
  });

  it("returns correct min/max for multiple points", () => {
    const result = geodesicBounds([
      [0, 0],
      [10, 5],
      [-3, 3],
    ]);
    expect(result[0]).toEqual([-3, 0]);
    expect(result[1]).toEqual([10, 5]);
  });

  it("applies padding correctly", () => {
    const result = geodesicBounds(
      [[0, 0], [1, 1]],
      111.32
    );
    expect(result[0][1]).toBeLessThan(0);
    expect(result[1][1]).toBeGreaterThan(1);
  });
});

describe("subdivideExtent", () => {
  it("returns 4 cells for cols=2, rows=2", () => {
    const result = subdivideExtent([0, 10, 0, 10], 2, 2);
    expect(result.length).toBe(4);
  });

  it("each cell has 4 corners", () => {
    const result = subdivideExtent([0, 10, 0, 10], 2, 2);
    for (const cell of result) {
      expect(cell.length).toBe(4);
    }
  });

  it("returns 1 cell for cols=1, rows=1", () => {
    const result = subdivideExtent([0, 10, 0, 10], 1, 1);
    expect(result.length).toBe(1);
  });

  it("total area equals original extent", () => {
    const result = subdivideExtent([0, 10, 0, 10], 2, 2);
    expect(result.length).toBe(4);
  });
});
