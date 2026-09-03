"use client";

import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { Map, Source, Layer } from "react-map-gl/maplibre";
import type { ViewState, MapRef, ErrorEvent, ViewStateChangeEvent } from "react-map-gl/maplibre";
import { AlertTriangle, RotateCcw } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { densifyGeoJSONFeature } from "@/lib/geodesic";
import { LIGHT_STYLE, DARK_STYLE } from "@/lib/map-styles";
import { LAYER_IDS, DEFAULT_TILE_ZOOM_MAX } from "@/lib/map-utils";
import { getMapColors } from "@/lib/map-theme";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { FeatureCollection } from "geojson";
import { getToken } from "@/services/api";
import { MapToolbar } from "./map-toolbar";
import intersect from "@turf/intersect";
import bboxPolygon from "@turf/bbox-polygon";

function extentBounds(
  coords: [[number, number], [number, number], [number, number], [number, number]]
): [[number, number], [number, number]] {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

interface MaplibreMapProps {
  runId: string;
  band: string;
  theme: string | undefined;
  initialViewState?: Partial<ViewState>;
  coordinates?: [[number, number], [number, number], [number, number], [number, number]];
  tileZoomMin?: number;
  tileZoomMax?: number;
  tileBounds?: [number, number, number, number];
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
  boundaryGeoJSON?: FeatureCollection | null;
  layerVisibility: Record<string, boolean>;
  onToggleLayer: (layer: string) => void;
  basemap: "light" | "dark";
  onToggleBasemap: () => void;
}

export default function MaplibreMap({
  runId, band, theme, initialViewState, coordinates, tileZoomMin, tileZoomMax, tileBounds,
  eooGeoJSON, aooGeoJSON, boundaryGeoJSON,
  layerVisibility, onToggleLayer, basemap, onToggleBasemap,
}: MaplibreMapProps) {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsAdded = useRef(false);
  const webglContextLostRef = useRef<((e: Event) => void) | null>(null);
  const webglContextRestoredRef = useRef<(() => void) | null>(null);
  const [tileErrors, setTileErrors] = useState(0);
  const [tileAuthWarning, setTileAuthWarning] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);
  const [showAllOverlays, setShowAllOverlays] = useState(false);
  const [cursorCoords, setCursorCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const [coordsCopied, setCoordsCopied] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);
  const [suitabilityPopup, setSuitabilityPopup] = useState<{ x: number; y: number; value: number } | null>(null);

  const safeTheme = (theme === "dark" || theme === "light") ? theme : "dark";
  const colors = useMemo(() => getMapColors(safeTheme), [safeTheme]);

  const isVisible = useCallback(
    (layer: string) => (layerVisibility[layer] !== false ? "visible" : "none"),
    [layerVisibility]
  );

  const handleTileError = useCallback(() => {
    setTileErrors((prev) => Math.min(prev + 1, 99));
  }, []);

  const handleTileAuthWarning = useCallback(() => {
    setTileAuthWarning(true);
  }, []);

  useEffect(() => {
    controlsAdded.current = false;
  }, [runId]);

  useEffect(() => {
    return () => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const canvas = map.getCanvas();
      if (webglContextLostRef.current) {
        canvas.removeEventListener("webglcontextlost", webglContextLostRef.current);
        webglContextLostRef.current = null;
      }
      if (webglContextRestoredRef.current) {
        canvas.removeEventListener("webglcontextrestored", webglContextRestoredRef.current);
        webglContextRestoredRef.current = null;
      }
    };
  }, []);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.getMap()?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.getMap()?.zoomOut();
  }, []);

  const densifiedEoo = useMemo(() => {
    if (!eooGeoJSON || !coordinates) return null;
    const feat = eooGeoJSON.features[0];
    if (!feat) return null;
    const densified = densifyGeoJSONFeature(feat, 20);
    if (!densified) return null;
    try {
      const extentPoly = bboxPolygon([
        ...extentBounds(coordinates)[0],
        ...extentBounds(coordinates)[1],
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clipped = intersect({ type: "FeatureCollection", features: [densified as any, extentPoly] });
      return clipped as FeatureCollection | null;
    } catch {
      return null;
    }
  }, [eooGeoJSON, coordinates]);

  const densifiedAoo = useMemo<FeatureCollection | null>(() => {
    if (!aooGeoJSON) return null;
    return {
      ...aooGeoJSON,
      features: aooGeoJSON.features.map((f) => densifyGeoJSONFeature(f, 5)),
    };
  }, [aooGeoJSON]);

  const densifiedBoundary = useMemo<FeatureCollection | null>(() => {
    if (!boundaryGeoJSON) return null;
    return {
      ...boundaryGeoJSON,
      features: boundaryGeoJSON.features.map((f) => densifyGeoJSONFeature(f, 10)),
    };
  }, [boundaryGeoJSON]);

  const maskGeoJSON = useMemo<FeatureCollection | null>(() => {
    if (!coordinates) return null;
    const outerRing: [number, number][] = [
      [-180, -85.0511], [180, -85.0511], [180, 85.0511], [-180, 85.0511], [-180, -85.0511],
    ];
    const holeRing: [number, number][] = [
      coordinates[0], coordinates[1], coordinates[2], coordinates[3], coordinates[0],
    ];
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "Polygon" as const,
            coordinates: [outerRing, holeRing],
          },
        },
      ],
    };
  }, [coordinates]);

  const hasEoo = !!densifiedEoo;
  const hasAoo = !!densifiedAoo;
  const hasBoundary = !!densifiedBoundary;
  const hasExtent = !!coordinates;

  const disabledLayers = useMemo(() => {
    const d: string[] = [];
    if (!hasEoo) d.push(LAYER_IDS.EOO);
    if (!hasAoo) d.push(LAYER_IDS.AOO);
    if (!hasBoundary) d.push(LAYER_IDS.BOUNDARY);
    if (!hasExtent) d.push(LAYER_IDS.EXTENT);
    return d;
  }, [hasEoo, hasAoo, hasBoundary, hasExtent]);

  const suitabilityVisibility = isVisible(LAYER_IDS.SUITABILITY);
  const aooVisibility = hasAoo && (showAllOverlays || isVisible(LAYER_IDS.AOO) === "visible") ? "visible" : "none";
  const boundaryVisibility = hasBoundary && (showAllOverlays || isVisible(LAYER_IDS.BOUNDARY) === "visible") ? "visible" : "none";
  const extentVisibility = hasExtent && (showAllOverlays || isVisible(LAYER_IDS.EXTENT) === "visible") ? "visible" : "none";
  const eooVisibility = hasEoo && (showAllOverlays || isVisible(LAYER_IDS.EOO) === "visible") ? "visible" : "none";

  const handleResetNorth = useCallback(() => {
    mapRef.current?.getMap()?.resetNorth();
  }, []);

  const handleFitExtent = useCallback(() => {
    if (!coordinates) return;
    const bounds = extentBounds(coordinates);
    mapRef.current?.getMap()?.fitBounds(bounds, { padding: 40, maxZoom: 16 });
  }, [coordinates]);

  const handleMapError = useCallback(
    (e: ErrorEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapError = e.error as unknown as { status?: number };
      const status = mapError.status;
      if (status === 401) {
        handleTileAuthWarning();
        return;
      }
      if (!status || (status >= 400 && status < 600)) {
        handleTileError();
      }
    },
    [handleTileAuthWarning, handleTileError]
  );

  const handleZoomEnd = useCallback((e: ViewStateChangeEvent) => {
    const zoom = e.viewState.zoom;
    if (typeof zoom === "number") setCurrentZoom(zoom);
    setPitch(e.viewState.pitch ?? 0);
  }, []);

  const handlePitchToggle = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const newPitch = pitch === 0 ? 60 : 0;
    map.setPitch(newPitch);
    setPitch(newPitch);
  }, [pitch]);

  useKeyboardShortcuts({
    onResetNorth: handleResetNorth,
    onFitExtent: handleFitExtent,
    onToggleBasemap: onToggleBasemap,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onPitchToggle: handlePitchToggle,
  });

  const handleMapMouseMove = useCallback(
    (e: maplibregl.MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const lngLat = map.unproject([e.point.x, e.point.y]);
      setCursorCoords({ lng: lngLat.lng, lat: lngLat.lat });

      const interactiveLayers = ["aoo-grid-fill", "eoo-polygon-fill", "boundary-fill"];
      const features = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      if (features.length > 0) {
        const id = features[0].id;
        if (id !== hoveredFeatureId) {
          if (hoveredFeatureId) map.setFeatureState({ source: features[0].source!, id: hoveredFeatureId }, { hover: false });
          map.setFeatureState({ source: features[0].source!, id: id as string }, { hover: true });
          setHoveredFeatureId(id as string);
        }
        map.getCanvas().style.cursor = "pointer";
      } else {
        if (hoveredFeatureId) {
          map.queryRenderedFeatures({ layers: interactiveLayers }).forEach((f) => {
            if (f.id === hoveredFeatureId) {
              map.setFeatureState({ source: f.source!, id: hoveredFeatureId }, { hover: false });
            }
          });
          setHoveredFeatureId(null);
        }
        map.getCanvas().style.cursor = "";
      }
    },
    [hoveredFeatureId]
  );

  const handleMapClick = useCallback(
    (e: maplibregl.MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ["suitability-overlay"] });
      if (features.length > 0) {
        setSuitabilityPopup({ x: e.point.x, y: e.point.y, value: e.lngLat.lng });
      } else {
        setSuitabilityPopup(null);
      }
    },
    []
  );

  const tileUrl = `/api/v1/results/tiles/${runId}/{z}/{x}/{y}?band=${encodeURIComponent(band)}`;

  const transformRequest = useCallback(
    (url: string, resourceType?: string) => {
      if (resourceType === "Tile" && url.includes("/api/v1/results/tiles/")) {
        const token = typeof window !== "undefined" ? getToken() : null;
        return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
      }
      return { url };
    },
    []
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      aria-label="Suitability map"
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const map = mapRef.current?.getMap();
        if (!map) return;
        const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, lng: lngLat.lng, lat: lngLat.lat });
      }}
    >
      <Map
        ref={mapRef}
        key={runId}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={basemap === "dark" ? DARK_STYLE : LIGHT_STYLE}
        maxZoom={18}
        onError={handleMapError}
        onZoomEnd={handleZoomEnd}
        onMouseMove={handleMapMouseMove}
        onMouseLeave={() => {
          setCursorCoords(null);
          const map = mapRef.current?.getMap();
          if (map && hoveredFeatureId) {
            const interactiveLayers = ["aoo-grid-fill", "eoo-polygon-fill", "boundary-fill"];
            map.queryRenderedFeatures({ layers: interactiveLayers }).forEach((f) => {
              if (f.id === hoveredFeatureId) {
                map.setFeatureState({ source: f.source!, id: hoveredFeatureId }, { hover: false });
              }
            });
            setHoveredFeatureId(null);
          }
          map?.getCanvas().style.removeProperty("cursor");
        }}
        onClick={handleMapClick}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          if (controlsAdded.current) return;
          controlsAdded.current = true;
          map.addControl(new maplibregl.NavigationControl(), "bottom-right");
          map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
          webglContextLostRef.current = (e: Event) => {
            e.preventDefault();
            setContextLost(true);
          };
          webglContextRestoredRef.current = () => {
            setContextLost(false);
            map.triggerRepaint();
          };
          const canvas = map.getCanvas();
          canvas.addEventListener("webglcontextlost", webglContextLostRef.current);
          canvas.addEventListener("webglcontextrestored", webglContextRestoredRef.current);
          if (pitch > 0) map.setPitch(pitch);
        }}
        transformRequest={transformRequest}
      >
        <Source
          id="suitability"
          type="raster"
          tiles={[tileUrl]}
          tileSize={256}
          minzoom={tileZoomMin && tileZoomMin > 0 ? tileZoomMin : 0}
          maxzoom={tileZoomMax && tileZoomMax > 0 ? tileZoomMax : 18}
          bounds={tileBounds}
          attribution="© SDM Platform"
        >
          <Layer
            id="suitability-overlay"
            type="raster"
            layout={{ visibility: suitabilityVisibility }}
            paint={{ "raster-opacity": 0.9999, "raster-fade-duration": 0, "raster-resampling": "nearest" }}
          />
        </Source>

        {maskGeoJSON && (
          <Source id="extent-mask" type="geojson" data={maskGeoJSON}>
            <Layer
              id="extent-mask-fill"
              type="fill"
              layout={{ visibility: suitabilityVisibility }}
              paint={{ "fill-opacity": 0 }}
            />
          </Source>
        )}

        {hasAoo && densifiedAoo && (
          <Source
            id="aoo-grid"
            type="geojson"
            data={densifiedAoo}
            cluster={true}
            clusterMaxZoom={14}
            clusterRadius={50}
          >
            <Layer
              id="aoo-cluster-circles"
              type="circle"
              filter={["has", "point_count"]}
              layout={{ visibility: aooVisibility }}
              paint={{
                "circle-color": [
                  "step",
                  ["get", "point_count"],
                  colors.aooFill,
                  10, colors.aooFill,
                  50, colors.aooFill,
                ],
                "circle-radius": ["step", ["get", "point_count"], 12, 10, 18, 50, 24],
                "circle-opacity": 0.7,
                "circle-stroke-width": 1,
                "circle-stroke-color": colors.aooOutline,
                "circle-stroke-opacity": 0.5,
              }}
            />
            <Layer
              id="aoo-cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{
                visibility: aooVisibility,
                "text-field": "{point_count_abbreviated}",
                "text-font": ["Open Sans Bold"],
                "text-size": 11,
              }}
              paint={{ "text-color": "#ffffff" }}
            />
            <Layer
              id="aoo-grid-fill"
              type="fill"
              filter={["!", ["has", "point_count"]]}
              layout={{ visibility: aooVisibility }}
              paint={{
                "fill-color": colors.aooFill,
                "fill-opacity": [
                  "case",
                  ["==", ["feature-state", "hover"], true],
                  0.6,
                  colors.aooFillOpacity,
                ],
                "fill-outline-color": colors.aooOutline,
              }}
            />
          </Source>
        )}

        {hasBoundary && densifiedBoundary && (
          <Source id="boundary-polygon" type="geojson" data={densifiedBoundary}>
            <Layer
              id="boundary-fill"
              type="fill"
              layout={{ visibility: boundaryVisibility }}
              paint={{
                "fill-color": colors.boundaryFill,
                "fill-opacity": [
                  "case",
                  ["==", ["feature-state", "hover"], true],
                  0.25,
                  colors.boundaryFillOpacity,
                ],
              }}
            />
            <Layer
              id="boundary-outline"
              type="line"
              layout={{ visibility: boundaryVisibility }}
              paint={{
                "line-color": colors.boundaryOutline,
                "line-width": [
                  "case",
                  ["==", ["feature-state", "hover"], true],
                  3,
                  2,
                ],
                "line-opacity": colors.boundaryOutlineOpacity,
              }}
            />
          </Source>
        )}

        {hasExtent && coordinates && (
          <Source
            id="extent-boundary"
            type="geojson"
            data={{
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "Polygon",
                    coordinates: [[coordinates[0], coordinates[1], coordinates[2], coordinates[3], coordinates[0]]],
                  },
                },
              ],
            }}
          >
            <Layer
              id="extent-boundary-outline"
              type="line"
              layout={{ visibility: extentVisibility }}
              paint={{
                "line-color": colors.extentOutline,
                "line-width": 1.5,
                "line-opacity": colors.extentOutlineOpacity,
                "line-dasharray": colors.extentDashArray,
              }}
            />
          </Source>
        )}

        {hasEoo && densifiedEoo && (
          <Source id="eoo-polygon" type="geojson" data={densifiedEoo}>
            <Layer
              id="eoo-polygon-fill"
              type="fill"
              layout={{ visibility: eooVisibility }}
              paint={{
                "fill-color": colors.eooFill,
                "fill-opacity": [
                  "case",
                  ["==", ["feature-state", "hover"], true],
                  0.3,
                  colors.eooFillOpacity,
                ],
              }}
            />
            <Layer
              id="eoo-polygon-outline"
              type="line"
              layout={{ visibility: eooVisibility }}
              paint={{
                "line-color": colors.eooOutline,
                "line-width": [
                  "case",
                  ["==", ["feature-state", "hover"], true],
                  3,
                  2,
                ],
                "line-opacity": colors.eooOutlineOpacity,
                "line-dasharray": [4, 3],
              }}
            />
          </Source>
        )}
      </Map>

      {currentZoom !== null && currentZoom > (tileZoomMax ?? DEFAULT_TILE_ZOOM_MAX) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-md bg-sdm-surface/90 px-3 py-1.5 text-xs text-sdm-warning shadow-sm border border-sdm-warning/30 whitespace-nowrap">
          Suitability overlay not available at zoom {Math.round(currentZoom)} — zoom out
        </div>
      )}

      {tileErrors > 5 && (
        <div className="absolute bottom-16 left-3 z-10 flex items-center gap-1.5 rounded-md bg-sdm-warning/10 px-2.5 py-1.5 text-[11px] text-sdm-warning border border-sdm-warning/30">
          <AlertTriangle className="h-3 w-3" />
          <span>{tileErrors} tile errors</span>
          <button
            onClick={() => {
              setTileErrors(0);
              mapRef.current?.getMap()?.triggerRepaint();
            }}
            className="ml-1 text-sdm-warning/70 hover:text-sdm-warning transition-colors bg-transparent border-none cursor-pointer text-[11px] underline"
            aria-label="Retry tiles"
          >
            Retry
          </button>
          <button
            onClick={() => setTileErrors(0)}
            className="ml-1 text-sdm-warning/70 hover:text-sdm-warning transition-colors bg-transparent border-none cursor-pointer text-[11px]"
            aria-label="Dismiss tile errors"
          >
            ×
          </button>
        </div>
      )}

      {tileAuthWarning && (
        <div className="absolute bottom-16 right-3 z-10 flex items-center gap-1.5 rounded-md bg-sdm-error/10 px-2.5 py-1.5 text-[11px] text-sdm-error border border-sdm-error/30">
          <AlertTriangle className="h-3 w-3" />
          <span>Tile access denied — log in again to refresh credentials</span>
          <button
            onClick={() => setTileAuthWarning(false)}
            className="ml-1 text-sdm-error/70 hover:text-sdm-error transition-colors bg-transparent border-none cursor-pointer text-[11px]"
            aria-label="Dismiss tile auth warning"
          >
            ×
          </button>
        </div>
      )}

      {contextLost && (
        <button
          onClick={() => window.location.reload()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-md bg-sdm-error/10 px-3 py-2 text-xs text-sdm-error border border-sdm-error/30 cursor-pointer bg-transparent"
          aria-label="Reload page to restore map"
        >
          <RotateCcw className="h-3 w-3" />
          <span>WebGL context lost — click to reload</span>
        </button>
      )}

      {cursorCoords && !contextLost && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 rounded-md bg-sdm-surface/90 px-2 py-1 text-[11px] text-sdm-muted font-mono border border-sdm-border/50 pointer-events-none">
          {cursorCoords.lat.toFixed(5)}, {cursorCoords.lng.toFixed(5)}
        </div>
      )}

      {contextMenu && !contextLost && (
        <div
          className="absolute z-20 rounded-md bg-sdm-surface border border-sdm-border shadow-md text-[11px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            onClick={() => {
              const coordStr = `${contextMenu.lat.toFixed(5)}, ${contextMenu.lng.toFixed(5)}`;
              navigator.clipboard.writeText(coordStr).catch(() => {});
              setCoordsCopied(true);
              setTimeout(() => setCoordsCopied(false), 1500);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-3 py-2 hover:bg-sdm-surface-soft w-full text-left text-sdm-text cursor-pointer bg-transparent border-none"
          >
            {coordsCopied ? "Copied!" : "Copy coordinates"}
          </button>
        </div>
      )}

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
        {(hasAoo || hasBoundary || hasExtent || hasEoo) && (
          <button
            onClick={() => setShowAllOverlays((v) => !v)}
            className={`rounded-md px-2 py-1 text-[11px] transition-colors border cursor-pointer ${
              showAllOverlays
                ? "bg-sdm-accent/20 text-sdm-accent border-sdm-accent/30"
                : "bg-sdm-surface/90 text-sdm-muted border-sdm-border/50 hover:bg-sdm-surface-soft"
            }`}
            title="Show all overlays"
          >
            All
          </button>
        )}
        <button
          onClick={handlePitchToggle}
          className="rounded-md px-2 py-1 text-[11px] transition-colors border cursor-pointer bg-sdm-surface/90 text-sdm-muted border-sdm-border/50 hover:bg-sdm-surface-soft"
          title={pitch === 0 ? "Enable 3D tilt" : "Reset to flat view"}
        >
          {pitch === 0 ? "3D" : "2D"}
        </button>
      </div>

      {suitabilityPopup && (
        <div
          className="absolute z-20 rounded-md bg-sdm-surface border border-sdm-border shadow-md px-2 py-1 text-[11px] text-sdm-text pointer-events-none"
          style={{ left: suitabilityPopup.x + 10, top: suitabilityPopup.y - 30 }}
        >
          {isNaN(suitabilityPopup.value) ? "—" : suitabilityPopup.value.toFixed(3)}
        </div>
      )}

      <MapToolbar
        layers={layerVisibility}
        onToggleLayer={onToggleLayer}
        basemap={basemap}
        onToggleBasemap={onToggleBasemap}
        onResetNorth={handleResetNorth}
        onFitExtent={handleFitExtent}
        disabledLayers={disabledLayers}
        containerRef={containerRef}
      />
    </div>
  );
}
