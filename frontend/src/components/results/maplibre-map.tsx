"use client";

import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { Map, Source, Layer, useMap } from "react-map-gl/maplibre";
import type { ViewState, MapRef, ErrorEvent } from "react-map-gl/maplibre";
import { AlertTriangle, Loader2 } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { densifyGeoJSONFeature } from "@/lib/geodesic";
import { LIGHT_STYLE, DARK_STYLE } from "@/lib/map-styles";
import { LAYER_IDS } from "@/lib/map-utils";
import type { FeatureCollection, Polygon } from "geojson";
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
  runId, theme, initialViewState, coordinates, tileZoomMin, tileZoomMax, tileBounds,
  eooGeoJSON, aooGeoJSON, boundaryGeoJSON,
  layerVisibility, onToggleLayer, basemap, onToggleBasemap,
}: MaplibreMapProps) {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsAdded = useRef(false);
  const [tileErrors, setTileErrors] = useState(0);
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);

  const handleTileError = useCallback(() => {
    setTileErrors(prev => Math.min(prev + 1, 99));
  }, []);

  // Reset controls ref when component re-mounts (key prop change)
  useEffect(() => { controlsAdded.current = false; }, []);

  const mapStyle = basemap === "dark" ? DARK_STYLE : LIGHT_STYLE;
  const coords = coordinates;

  const densifiedEoo = useMemo(() => {
    if (!eooGeoJSON || !coordinates) return null;
    const feat = eooGeoJSON.features[0];
    if (!feat) return null;
    const densified = densifyGeoJSONFeature(feat, 20);
    if (!densified) return null;
    // Clip EOO polygon to projection extent to prevent red overlay outside target area
    try {
      const extentPoly = bboxPolygon([
        Math.min(...coordinates.map(c => c[0])),
        Math.min(...coordinates.map(c => c[1])),
        Math.max(...coordinates.map(c => c[0])),
        Math.max(...coordinates.map(c => c[1])),
      ]);
      const clipped = intersect({ type: "FeatureCollection", features: [densified as any, extentPoly] });
      return clipped || null;
    } catch {
      return densified as any;
    }
  }, [eooGeoJSON, coordinates]);

  const densifiedAoo = useMemo(() => {
    if (!aooGeoJSON) return null;
    return {
      ...aooGeoJSON,
      features: aooGeoJSON.features.map((f) => densifyGeoJSONFeature(f, 5)),
    } as FeatureCollection;
  }, [aooGeoJSON]);

  const densifiedBoundary = useMemo(() => {
    if (!boundaryGeoJSON) return null;
    return {
      ...boundaryGeoJSON,
      features: boundaryGeoJSON.features.map((f) => densifyGeoJSONFeature(f, 10)),
    } as FeatureCollection;
  }, [boundaryGeoJSON]);

  const handleResetNorth = useCallback(() => {
    mapRef.current?.getMap()?.resetNorth();
  }, []);

  const handleFitExtent = useCallback(() => {
    if (!coords) return;
    const bounds = extentBounds(coords);
    mapRef.current?.getMap()?.fitBounds(bounds, { padding: 40, maxZoom: 12 });
  }, [coords]);

  const visibility = (layer: string) =>
    layerVisibility[layer] !== false ? "visible" : "none";

  const hasEoo = !!densifiedEoo;
  const hasAoo = !!densifiedAoo;
  const hasBoundary = !!densifiedBoundary;
  const hasExtent = !!coords;

  const disabledLayers = useMemo(() => {
    const d: string[] = [];
    if (!hasEoo) d.push(LAYER_IDS.EOO);
    if (!hasAoo) d.push(LAYER_IDS.AOO);
    if (!hasBoundary) d.push(LAYER_IDS.BOUNDARY);
    if (!hasExtent) d.push(LAYER_IDS.EXTENT);
    return d;
  }, [hasEoo, hasAoo, hasBoundary, hasExtent]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full [&_.maplibregl-canvas]:image-rendering-pixelated"
      aria-label="Suitability map"
    >
      <Map
        ref={mapRef}
        key={runId}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        maxZoom={18}
        pixelRatio={1}
        onError={(e: ErrorEvent) => {
          const status = (e.error as any)?.status;
          if (status >= 400 && status < 600) {
            handleTileError();
          }
        }}
        onZoomEnd={(e) => {
          const zoom = (e.target as any)?.getZoom();
          if (typeof zoom === "number") setCurrentZoom(zoom);
        }}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          if ((map as any)._sdmControlsAdded) return;
          (map as any)._sdmControlsAdded = true;
          map.addControl(new maplibregl.NavigationControl(), "bottom-right");
          map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
        }}
        transformRequest={(url: string, resourceType?: string) => {
          if (resourceType === "Tile" && url.includes("/api/v1/results/tiles/")) {
            const token = typeof window !== "undefined" ? getToken() : null;
            return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
          }
          return { url };
        }}
      >
      <Source
        id="suitability"
        type="raster"
        tiles={[`/api/v1/results/tiles/${runId}/{z}/{x}/{y}`]}
        tileSize={256}
        minzoom={0}
        maxzoom={18}
        bounds={tileBounds}
      >
          <Layer
            id="suitability-overlay"
            type="raster"
            layout={{ visibility: visibility(LAYER_IDS.SUITABILITY) }}
            paint={{ "raster-opacity": 0.9999, "raster-fade-duration": 0 }}
          />
        </Source>

        {hasAoo && (
          <Source id="aoo-grid" type="geojson" data={densifiedAoo!}>
            <Layer
              id="aoo-grid-fill"
              type="fill"
              layout={{ visibility: visibility(LAYER_IDS.AOO) }}
              paint={{
                "fill-color": theme === "dark" ? "#fbbf24" : "#f59e0b",
                "fill-opacity": 0.25,
                "fill-outline-color": theme === "dark" ? "#fbbf24" : "#d97706",
              }}
            />
          </Source>
        )}

        {hasBoundary && (
          <Source id="boundary-polygon" type="geojson" data={densifiedBoundary!}>
            <Layer
              id="boundary-fill"
              type="fill"
              layout={{ visibility: visibility(LAYER_IDS.BOUNDARY) }}
              paint={{
                "fill-color": "#06b6d4",
                "fill-opacity": 0.08,
              }}
            />
            <Layer
              id="boundary-outline"
              type="line"
              layout={{ visibility: visibility(LAYER_IDS.BOUNDARY) }}
              paint={{
                "line-color": "#06b6d4",
                "line-width": 2,
                "line-opacity": 0.6,
              }}
            />
          </Source>
        )}

        {hasExtent && (
          <Source
            id="extent-boundary"
            type="geojson"
            data={{
              type: "FeatureCollection",
              features: [{
                type: "Feature",
                properties: {},
                geometry: {
                  type: "Polygon",
                  coordinates: [[
                    coords[0], coords[1], coords[2], coords[3], coords[0],
                  ]],
                },
              }],
            }}
          >
            <Layer
              id="extent-boundary-outline"
              type="line"
              layout={{ visibility: visibility(LAYER_IDS.EXTENT) }}
              paint={{
                "line-color": theme === "dark" ? "#60a5fa" : "#2563eb",
                "line-width": 1.5,
                "line-opacity": 0.5,
                "line-dasharray": [6, 3],
              }}
            />
          </Source>
        )}

        {hasEoo && (
          <Source id="eoo-polygon" type="geojson" data={{
            type: "FeatureCollection",
            features: [densifiedEoo as GeoJSON.Feature],
          }}>
            <Layer
              id="eoo-polygon-fill"
              type="fill"
              layout={{ visibility: visibility(LAYER_IDS.EOO) }}
              paint={{
                "fill-color": theme === "dark" ? "#ef4444" : "#dc2626",
                "fill-opacity": 0.08,
              }}
            />
            <Layer
              id="eoo-polygon-outline"
              type="line"
              layout={{ visibility: visibility(LAYER_IDS.EOO) }}
              paint={{
                "line-color": theme === "dark" ? "#ef4444" : "#dc2626",
                "line-width": 2,
                "line-opacity": 0.8,
                "line-dasharray": [4, 3],
              }}
            />
          </Source>
        )}
      </Map>

      {currentZoom !== null && currentZoom > (tileZoomMax ?? 8) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-md bg-sdm-surface/90 px-3 py-1.5 text-xs text-sdm-warning shadow-sm border border-sdm-warning/30 whitespace-nowrap">
          Suitability overlay not available at zoom {Math.round(currentZoom)} — zoom out
        </div>
      )}

      {tileErrors > 5 && (
        <div className="absolute bottom-16 left-3 z-10 flex items-center gap-1.5 rounded-md bg-sdm-warning/10 px-2.5 py-1.5 text-[11px] text-sdm-warning border border-sdm-warning/30">
          <AlertTriangle className="h-3 w-3" />
          <span>{tileErrors} tile error{tileErrors !== 1 ? "s" : ""}</span>
          <button onClick={() => setTileErrors(0)} className="ml-1 text-sdm-warning/70 hover:text-sdm-warning transition-colors" aria-label="Dismiss tile errors">
            ×
          </button>
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