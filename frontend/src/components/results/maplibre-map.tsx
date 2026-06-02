"use client";

import { useMemo } from "react";
import { Map, Source, Layer } from "react-map-gl/maplibre";
import type { ViewState } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { densifyGeoJSONFeature } from "@/lib/geodesic";
import type { FeatureCollection } from "geojson";
import { getToken } from "@/services/api";

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

interface MaplibreMapProps {
  runId: string;
  theme: string | undefined;
  initialViewState?: Partial<ViewState>;
  coordinates?: [[number, number], [number, number], [number, number], [number, number]];
  tileZoomMin?: number;
  tileZoomMax?: number;
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
}

export default function MaplibreMap({ runId, theme, initialViewState, coordinates, tileZoomMin, tileZoomMax, eooGeoJSON, aooGeoJSON }: MaplibreMapProps) {
  const mapStyle = theme === "dark" ? DARK_STYLE : LIGHT_STYLE;
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

  return (
    <Map
      key={coords ? coords[0][0].toFixed(1) + coords[0][1].toFixed(1) : runId}
      initialViewState={initialViewState}
      style={{ width: "100%", height: "100%" }}
      mapStyle={mapStyle}
      maxZoom={18}
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
          paint={{ "raster-opacity": 0.7 }}
        />
      </Source>

      {densifiedAoo && (
        <Source id="aoo-grid" type="geojson" data={densifiedAoo}>
          <Layer
            id="aoo-grid-fill"
            type="fill"
            paint={{
              "fill-color": theme === "dark" ? "#fbbf24" : "#f59e0b",
              "fill-opacity": 0.25,
              "fill-outline-color": theme === "dark" ? "#fbbf24" : "#d97706",
            }}
          />
        </Source>
      )}

      {coords && (
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
            paint={{
              "line-color": theme === "dark" ? "#60a5fa" : "#2563eb",
              "line-width": 1.5,
              "line-opacity": 0.5,
              "line-dasharray": [6, 3],
            }}
          />
        </Source>
      )}

      {densifiedEoo && (
        <Source id="eoo-polygon" type="geojson" data={{
          type: "FeatureCollection",
          features: [densifiedEoo as GeoJSON.Feature],
        }}>
          <Layer
            id="eoo-polygon-fill"
            type="fill"
            paint={{
              "fill-color": theme === "dark" ? "#ef4444" : "#dc2626",
              "fill-opacity": 0.08,
            }}
          />
          <Layer
            id="eoo-polygon-outline"
            type="line"
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
  );
}