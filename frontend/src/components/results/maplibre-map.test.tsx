import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import React from "react";

/**
 * Shared mutable fake map instance — tests reset its spies in beforeEach.
 * The component reads methods via `mapRef.current.getMap()`, so we expose
 * the fake map through the mocked `<Map>` component's ref.
 */
const mapInstance = {
  setFeatureState: vi.fn(),
  queryRenderedFeatures: vi.fn().mockReturnValue([]),
  getCanvas: vi.fn(() => ({
    style: { cursor: "", removeProperty: vi.fn() },
  })),
  triggerRepaint: vi.fn(),
  unproject: vi.fn((p: { x: number; y: number }) => ({ lng: p.x, lat: p.y })),
  fitBounds: vi.fn(),
  setPitch: vi.fn(),
  getCenter: vi.fn(() => ({ lat: 0, lng: 0 })),
  getZoom: vi.fn(() => 4),
  getPitch: vi.fn(() => 0),
  jumpTo: vi.fn(),
  setStyle: vi.fn(),
  setLayoutProperty: vi.fn(),
  getStyle: vi.fn(() => ({ layers: [] })),
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  getContainer: vi.fn(() => document.createElement("div")),
  loaded: vi.fn(() => true),
};

// MapRef is an object with `getMap()` method that returns the actual MapLibre map.
// We simulate the same shape.
const fakeMap = {
  getMap: () => mapInstance,
  setFeatureState: mapInstance.setFeatureState,
  queryRenderedFeatures: mapInstance.queryRenderedFeatures,
  getCanvas: mapInstance.getCanvas,
  triggerRepaint: mapInstance.triggerRepaint,
  unproject: mapInstance.unproject,
  fitBounds: mapInstance.fitBounds,
  setPitch: mapInstance.setPitch,
  getCenter: mapInstance.getCenter,
  getZoom: mapInstance.getZoom,
  getPitch: mapInstance.getPitch,
  jumpTo: mapInstance.jumpTo,
  setStyle: mapInstance.setStyle,
  setLayoutProperty: mapInstance.setLayoutProperty,
  getStyle: mapInstance.getStyle,
  on: mapInstance.on,
  off: mapInstance.off,
  remove: mapInstance.remove,
  getContainer: mapInstance.getContainer,
  loaded: mapInstance.loaded,
};

vi.mock("maplibre-gl", () => ({
  default: {
    Map: class {},
    NavigationControl: class {},
    AttributionControl: class {},
    ScaleControl: class {},
    GeolocateControl: class {},
  },
}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

interface CapturedMapProps {
  ref?: { current?: typeof fakeMap | null };
  onMouseMove?: (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => void;
  onMouseLeave?: () => void;
  onError?: (e: { type: string; error: Error & { status?: number } }) => void;
  onClick?: (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => void;
  onLoad?: () => void;
  onZoomEnd?: (e: { viewState: { zoom: number; pitch: number } }) => void;
  onMoveEnd?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

const captured: { current: CapturedMapProps | null } = { current: null };

vi.mock("react-map-gl/maplibre", () => ({
  Map: React.forwardRef<typeof fakeMap, CapturedMapProps>((props, ref) => {
    captured.current = props;
    if (ref && typeof ref === "object") {
      (ref as { current: typeof fakeMap }).current = fakeMap;
    }
    return <div data-testid="mock-map" />;
  }),
  Source: ({ id }: { id?: string }) => <div data-testid="mock-source" data-source-id={id} />,
  Layer: () => <div data-testid="mock-layer" />,
}));

vi.mock("@/lib/map-styles", () => ({
  LIGHT_STYLE: { version: 8, sources: {}, layers: [] },
  DARK_STYLE: { version: 8, sources: {}, layers: [] },
}));

vi.mock("@/lib/map-theme", () => ({
  getMapColors: () => ({
    aooFill: "#0ea5e9",
    aooFillOpacity: 0.3,
    aooOutline: "#0369a1",
    aooOutlineOpacity: 0.7,
    eooFill: "#22c55e",
    eooFillOpacity: 0.2,
    eooOutline: "#16a34a",
    eooOutlineOpacity: 0.8,
    boundaryFill: "#a855f7",
    boundaryFillOpacity: 0.15,
    boundaryOutline: "#7e22ce",
    boundaryOutlineOpacity: 0.6,
    extentOutline: "#f59e0b",
    extentOutlineOpacity: 0.7,
    extentDashArray: [4, 3] as [number, number],
  }),
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: () => {},
}));

vi.mock("@/services/api", () => ({
  getToken: () => null,
  apiGetSuitabilityValue: vi.fn().mockResolvedValue({ value: null }),
}));

vi.mock("@turf/intersect", () => ({ default: () => null }));
vi.mock("@turf/bbox-polygon", () => ({
  default: () => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[]] },
    properties: {},
  }),
}));

vi.mock("@/lib/geodesic", () => ({
  densifyGeoJSONFeature: (f: unknown) => f,
}));

vi.mock("./map-toolbar", () => ({
  MapToolbar: () => <div data-testid="map-toolbar" />,
}));

import MaplibreMap from "./maplibre-map";

const defaultEoo: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[100, -10], [120, -10], [120, -30], [100, -30], [100, -10]]] },
    },
  ],
};

const defaultAoo: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[100, -10], [120, -10], [120, -30], [100, -30], [100, -10]]] },
    },
  ],
};

const defaultProps = {
  runId: "test-run",
  band: "suitability",
  theme: "light" as const,
  initialViewState: { longitude: 110, latitude: -20, zoom: 4 },
  coordinates: [[100, -10], [120, -10], [120, -30], [100, -30]] as [[number, number], [number, number], [number, number], [number, number]],
  tileZoomMin: 0,
  tileZoomMax: 18,
  tileBounds: undefined as [number, number, number, number] | undefined,
  eooGeoJSON: undefined as GeoJSON.FeatureCollection | undefined,
  aooGeoJSON: undefined as GeoJSON.FeatureCollection | undefined,
  boundaryGeoJSON: undefined as GeoJSON.FeatureCollection | undefined,
  layerVisibility: { suitability: true, eoo: true, aoo: true, boundary: true, extent: true },
  onToggleLayer: () => {},
  basemap: "dark" as const,
  onToggleBasemap: () => {},
};

function renderMap(overrides: Partial<typeof defaultProps> = {}) {
  captured.current = null;
  mapInstance.setFeatureState.mockReset();
  mapInstance.queryRenderedFeatures.mockReset();
  mapInstance.queryRenderedFeatures.mockReturnValue([]);
  return render(<MaplibreMap {...defaultProps} {...overrides} />);
}

function setQueryRenderedFeaturesResult(features: unknown[]) {
  mapInstance.queryRenderedFeatures.mockImplementation(() => features);
}

function flushRaf() {
  return act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function flushTimers() {
  return act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mapInstance.setFeatureState.mockReset();
  mapInstance.queryRenderedFeatures.mockReset();
  mapInstance.queryRenderedFeatures.mockReturnValue([]);
  captured.current = null;
});

describe("MaplibreMap - handleMapError discrimination", () => {
  it("does NOT show tile error banner for plain Error without status", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMap();
    const onError = captured.current?.onError;
    expect(onError).toBeDefined();
    act(() => {
      onError!({ type: "error", error: new Error("setFeatureState misuse") as Error & { status?: number } });
    });
    expect(screen.queryByText(/tile errors/)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does NOT count Error with status=0 as a tile error", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMap();
    const onError = captured.current?.onError;
    act(() => {
      onError!({ type: "error", error: Object.assign(new Error("non-HTTP"), { status: 0 }) as Error & { status?: number } });
    });
    expect(screen.queryByText(/tile errors/)).toBeNull();
    warnSpy.mockRestore();
  });

  it("shows auth warning on HTTP 401, NOT tile error banner", () => {
    renderMap();
    const onError = captured.current?.onError;
    act(() => {
      onError!({ type: "error", error: Object.assign(new Error("Unauthorized"), { status: 401 }) as Error & { status?: number } });
    });
    expect(screen.queryByText(/tile errors/)).toBeNull();
    expect(screen.queryByText(/Tile access denied/)).not.toBeNull();
  });

  it("does NOT show banner immediately for single HTTP 500 error (threshold is >5)", () => {
    renderMap();
    const onError = captured.current?.onError;
    act(() => {
      onError!({ type: "error", error: Object.assign(new Error("Server"), { status: 500 }) as Error & { status?: number } });
    });
    expect(screen.queryByText(/tile errors/)).toBeNull();
  });

  it("shows tile error banner after >5 HTTP 500 errors", () => {
    renderMap();
    const onError = captured.current?.onError;
    act(() => {
      for (let i = 0; i < 6; i++) {
        onError!({ type: "error", error: Object.assign(new Error("Server"), { status: 500 }) as Error & { status?: number } });
      }
    });
    expect(screen.queryByText(/tile errors/)).not.toBeNull();
  });
});

describe("MaplibreMap - setFeatureState call shape", () => {
  it("calls setFeatureState with {source, id} object on hover of non-cluster feature", async () => {
    renderMap({ eooGeoJSON: defaultEoo });
    setQueryRenderedFeaturesResult([
      { id: "eoo-1", source: "eoo-polygon", properties: {} } as never,
    ]);

    const onMouseMove = captured.current?.onMouseMove;
    expect(onMouseMove).toBeDefined();
    act(() => {
      onMouseMove!({ point: { x: 100, y: 100 }, lngLat: { lng: 110, lat: -20 } });
    });
    await flushRaf();
    await flushRaf();

    expect(fakeMap.queryRenderedFeatures).toHaveBeenCalled();
    expect(fakeMap.setFeatureState).toHaveBeenCalledWith(
      { source: "eoo-polygon", id: "eoo-1" },
      { hover: true }
    );
  });

  it("does NOT call setFeatureState when hovering an AOO cluster feature", async () => {
    renderMap({ aooGeoJSON: defaultAoo });
    setQueryRenderedFeaturesResult([
      { id: "cluster-5", source: "aoo-grid", properties: { point_count: 5 } } as never,
    ]);

    const onMouseMove = captured.current?.onMouseMove;
    act(() => {
      onMouseMove!({ point: { x: 100, y: 100 }, lngLat: { lng: 110, lat: -20 } });
    });
    await flushRaf();

    expect(fakeMap.setFeatureState).not.toHaveBeenCalled();
  });

  it("clears hover state on mouseLeave for previously-hovered feature", async () => {
    renderMap({ eooGeoJSON: defaultEoo });
    const eooFeature = { id: "eoo-1", source: "eoo-polygon", properties: {} };

    mapInstance.queryRenderedFeatures.mockImplementation(() => [eooFeature]);
    const onMouseMove = captured.current?.onMouseMove;
    act(() => {
      onMouseMove!({ point: { x: 100, y: 100 }, lngLat: { lng: 110, lat: -20 } });
    });
    await flushRaf();

    expect(fakeMap.setFeatureState).toHaveBeenCalledWith(
      { source: "eoo-polygon", id: "eoo-1" },
      { hover: true }
    );

    mapInstance.setFeatureState.mockClear();

    // Simulate mouseLeave — the cleanup re-queries for the previously-hovered feature
    mapInstance.queryRenderedFeatures.mockImplementation(() => [eooFeature]);
    const onMouseLeave = captured.current?.onMouseLeave;
    act(() => {
      onMouseLeave?.();
    });

    expect(fakeMap.setFeatureState).toHaveBeenCalledWith(
      { source: "eoo-polygon", id: "eoo-1" },
      { hover: false }
    );
  });

  it("does NOT call setFeatureState on mouseLeave for cluster hover", async () => {
    renderMap({ aooGeoJSON: defaultAoo });
    setQueryRenderedFeaturesResult([
      { id: "cluster-3", source: "aoo-grid", properties: { point_count: 3 } } as never,
    ]);

    const onMouseMove = captured.current?.onMouseMove;
    act(() => {
      onMouseMove!({ point: { x: 100, y: 100 }, lngLat: { lng: 110, lat: -20 } });
    });
    await flushRaf();

    const onMouseLeave = captured.current?.onMouseLeave;
    mapInstance.setFeatureState.mockClear();
    act(() => {
      onMouseLeave?.();
    });

    expect(fakeMap.setFeatureState).not.toHaveBeenCalled();
  });
});
