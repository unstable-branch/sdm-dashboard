"use client";

import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { Map, Source, Layer } from "react-map-gl/maplibre";
import type { ViewState, MapRef } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { densifyGeoJSONFeature } from "@/lib/geodesic";
import type { FeatureCollection } from "geojson";
import { getToken } from "@/services/api";
import { MapToolbar } from "./map-toolbar";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const LIGHT_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: CARTO_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "carto-tiles",
      type: "raster" as const,
      source: "carto",
    },
  ],
};

const DARK_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: CARTO_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "carto-tiles",
      type: "raster" as const,
      source: "carto",
    },
  ],
};

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
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
  boundaryGeoJSON?: FeatureCollection | null;
  layerVisibility: Record<string, boolean>;
  onToggleLayer: (layer: string) => void;
  basemap: "light" | "dark";
  onToggleBasemap: () => void;
}

export default function MaplibreMap({
  runId, theme, initialViewState, coordinates, tileZoomMin, tileZoomMax,
  eooGeoJSON, aooGeoJSON, boundaryGeoJSON,
  layerVisibility, onToggleLayer, basemap, onToggleBasemap,
}: MaplibreMapProps) {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsAdded = useRef(false);
  const [resolvedBasemap, setResolvedBasemap] = useState<"light" | "dark">(basemap);

  useEffect(() => {
    if (basemap === "light" || basemap === "dark") {
      setResolvedBasemap(basemap);
    }
  }, [basemap]);

  const mapStyle = resolvedBasemap === "dark" ? DARK_STYLE : LIGHT_STYLE;
  const coords = coordinates;

  const densifiedEoo = useMemo(() => {
    if (!eooGeoJSON) return null;
    const feat = eooGeoJSON.features[0];
    if (!feat) return null;
    return densifyGeoJSONFeature(feat, 20);
  }, [eooGeoJSON]);

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
    if (!hasEoo) d.push("eoo");
    if (!hasAoo) d.push("aoo");
    if (!hasBoundary) d.push("boundary");
    if (!hasExtent) d.push("extent");
    return d;
  }, [hasEoo, hasAoo, hasBoundary, hasExtent]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <Map
        ref={mapRef}
        key={coords ? coords[0][0].toFixed(1) + coords[0][1].toFixed(1) : runId}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        maxZoom={18}
        onLoad={() => {
          if (controlsAdded.current) return;
          controlsAdded.current = true;
          const map = mapRef.current?.getMap();
          if (!map) return;
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
          minzoom={tileZoomMin ?? 4}
          maxzoom={tileZoomMax ?? 8}
        >
          <Layer
            id="suitability-overlay"
            type="raster"
            layout={{ visibility: visibility("suitability") }}
            paint={{ "raster-opacity": 0.7 }}
          />
        </Source>

        {hasAoo && (
          <Source id="aoo-grid" type="geojson" data={densifiedAoo!}>
            <Layer
              id="aoo-grid-fill"
              type="fill"
              layout={{ visibility: visibility("aoo") }}
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
              layout={{ visibility: visibility("boundary") }}
              paint={{
                "fill-color": "#06b6d4",
                "fill-opacity": 0.08,
              }}
            />
            <Layer
              id="boundary-outline"
              type="line"
              layout={{ visibility: visibility("boundary") }}
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
              layout={{ visibility: visibility("extent") }}
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
              layout={{ visibility: visibility("eoo") }}
              paint={{
                "fill-color": theme === "dark" ? "#ef4444" : "#dc2626",
                "fill-opacity": 0.08,
              }}
            />
            <Layer
              id="eoo-polygon-outline"
              type="line"
              layout={{ visibility: visibility("eoo") }}
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

      <MapToolbar
        layers={layerVisibility}
        onToggleLayer={onToggleLayer}
        basemap={resolvedBasemap}
        onToggleBasemap={onToggleBasemap}
        onResetNorth={handleResetNorth}
        onFitExtent={handleFitExtent}
        disabledLayers={disabledLayers}
        containerRef={containerRef}
      />
    </div>
  );
}