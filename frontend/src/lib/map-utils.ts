export const DEFAULT_TILE_ZOOM_MIN = 4;
export const DEFAULT_TILE_ZOOM_MAX = 8;

export const LAYER_IDS = {
  SUITABILITY: "suitability",
  EOO: "eoo",
  AOO: "aoo",
  BOUNDARY: "boundary",
  EXTENT: "extent",
} as const;

export function extentToZoom(extent: number[]): number {
  const [xmin, xmax, ymin, ymax] = extent;
  const maxSpan = Math.max(xmax - xmin, ymax - ymin);
  if (maxSpan > 50) return 3;
  if (maxSpan > 20) return 4;
  if (maxSpan > 10) return 5;
  if (maxSpan > 5) return 6;
  return 7;
}

export function extentToCoordinates(e?: number[] | null): [[number, number], [number, number], [number, number], [number, number]] | undefined {
  if (!e || e.length < 4) return undefined;
  return [[e[0], e[3]], [e[1], e[3]], [e[1], e[2]], [e[0], e[2]]];
}

export function extentToViewState(e?: number[] | null): { longitude: number; latitude: number; zoom: number } | undefined {
  if (!e || e.length < 4) return undefined;
  const [xmin, xmax, ymin, ymax] = e;
  return {
    longitude: (xmin + xmax) / 2,
    latitude: (ymin + ymax) / 2,
    zoom: extentToZoom(e),
  };
}

export function parseTileZoom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const parsed = parseInt(raw, 10);
  return !isNaN(parsed) ? parsed : fallback;
}
