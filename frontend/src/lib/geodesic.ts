import { Geodesic } from "geographiclib";

type GeoProxy = {
  Inverse(lat1: number, lon1: number, lat2: number, lon2: number): GeodesicResult;
  Line(lat: number, lon: number, azi1: number): { Position(s12: number): GeodesicResult };
  Polygon(init: number): { AddPoint(lat: number, lon: number): void; Compute(reverse: boolean, sign: boolean): PolygonResult };
};
const geo = Geodesic.WGS84 as unknown as GeoProxy;

const KM_PER_DEG = 111.32;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export type LngLat = [number, number];

interface GeodesicResult {
  lat1: number;
  lon1: number;
  azi1: number;
  lat2: number;
  lon2: number;
  azi2: number;
  s12: number;
  a12: number;
}

interface PolygonResult {
  number: number;
  perimeter: number;
  area: number;
}

function geodesicInv(p1: LngLat, p2: LngLat): GeodesicResult {
  const r = geo.Inverse(p1[1], p1[0], p2[1], p2[0]) as unknown as GeodesicResult;
  return r;
}

export function densifyLine(
  coords: LngLat[],
  maxSegmentKm: number = 10
): LngLat[] {
  if (coords.length < 2) return [...coords];

  const result: LngLat[] = [coords[0]];

  for (let i = 1; i < coords.length; i++) {
    const p1 = coords[i - 1];
    const p2 = coords[i];
    const inv = geodesicInv(p1, p2);
    const distKm = inv.s12 / 1000;

    if (distKm <= maxSegmentKm) {
      result.push(p2);
    } else {
      const numSegments = Math.ceil(distKm / maxSegmentKm);
      const line = geo.Line(p1[1], p1[0], inv.azi1);
      for (let j = 1; j <= numSegments; j++) {
        const pt = line.Position((j / numSegments) * inv.s12) as GeodesicResult;
        result.push([pt.lon2, pt.lat2]);
      }
    }
  }

  return result;
}

export function densifyPolygon(
  coords: LngLat[],
  maxSegmentKm: number = 10
): LngLat[] {
  if (coords.length < 3) return [...coords];

  const densified = densifyLine(coords, maxSegmentKm);
  const first = densified[0];
  const last = densified[densified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    densified.push([first[0], first[1]]);
  }
  return densified;
}

export function densifyGeoJSONFeature(
  feature: GeoJSON.Feature,
  maxSegmentKm: number = 10
): GeoJSON.Feature {
  if (!feature.geometry) return feature;
  if (feature.geometry.type === "Polygon") {
    const poly = feature.geometry as GeoJSON.Polygon;
    return {
      ...feature,
      geometry: {
        type: "Polygon",
        coordinates: poly.coordinates.map((ring) => densifyPolygon(ring as LngLat[], maxSegmentKm)),
      },
    };
  }
  if (feature.geometry.type === "MultiPolygon") {
    const mp = feature.geometry as GeoJSON.MultiPolygon;
    return {
      ...feature,
      geometry: {
        type: "MultiPolygon",
        coordinates: mp.coordinates.map((poly) =>
          poly.map((ring) => densifyPolygon(ring as LngLat[], maxSegmentKm))
        ),
      },
    };
  }
  if (feature.geometry.type === "LineString") {
    const line = feature.geometry as GeoJSON.LineString;
    return {
      ...feature,
      geometry: {
        type: "LineString",
        coordinates: densifyLine(line.coordinates as LngLat[], maxSegmentKm),
      },
    };
  }
  if (feature.geometry.type === "MultiLineString") {
    const ml = feature.geometry as GeoJSON.MultiLineString;
    return {
      ...feature,
      geometry: {
        type: "MultiLineString",
        coordinates: ml.coordinates.map((line) => densifyLine(line as LngLat[], maxSegmentKm)),
      },
    };
  }
  return feature;
}

export function geodesicDistanceKm(p1: LngLat, p2: LngLat): number {
  const inv = geodesicInv(p1, p2);
  return inv.s12 / 1000;
}

export function geodesicAreaKm2(coords: LngLat[]): number {
  if (coords.length < 3) return 0;
  const poly = geo.Polygon(0);
  for (const [lon, lat] of coords) {
    poly.AddPoint(lat, lon);
  }
  const result = poly.Compute(false, true) as PolygonResult;
  return Math.abs(result.area) / 1e6;
}

export function geodesicBounds(
  points: LngLat[],
  paddingKm: number = 0
): [[number, number], [number, number]] {
  if (points.length === 0) return [[0, 0], [0, 0]];

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const [lon, lat] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  if (paddingKm > 0) {
    const midLat = (minLat + maxLat) / 2;
    const kmPerDegLon = KM_PER_DEG * Math.cos(toRad(midLat));
    const padLat = Math.min(paddingKm / KM_PER_DEG, 90);
    const padLon = kmPerDegLon > 0 ? paddingKm / kmPerDegLon : 0;
    minLat = Math.max(-90, minLat - padLat);
    maxLat = Math.min(90, maxLat + padLat);
    minLon = minLon - padLon;
    maxLon = maxLon + padLon;
  }

  return [[minLon, minLat], [maxLon, maxLat]];
}

export function subdivideExtent(
  extent: [number, number, number, number],
  cols: number = 2,
  rows: number = 2
): [[number, number], [number, number], [number, number], [number, number]][] {
  const [xmin, xmax, ymin, ymax] = extent;
  const cellW = (xmax - xmin) / cols;
  const cellH = (ymax - ymin) / rows;
  const cells: [[number, number], [number, number], [number, number], [number, number]][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = xmin + c * cellW;
      const right = left + cellW;
      const top = ymax - r * cellH;
      const bottom = top - cellH;
      cells.push([
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ]);
    }
  }

  return cells;
}
