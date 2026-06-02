"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Map, Source, Layer, Popup } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Feature, Point } from "geojson";
import { geodesicBounds } from "@/lib/geodesic";

interface OccurrencePoint {
  longitude: number;
  latitude: number;
  source?: string;
  flagged?: boolean;
  [key: string]: unknown;
}

interface OccurrenceMapProps {
  points: OccurrencePoint[];
  flaggedIndices?: Set<number>;
}

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

const INITIAL_VIEW = {
  longitude: 135,
  latitude: -25,
  zoom: 3,
};

function buildGeoJSON(
  points: OccurrencePoint[],
  flaggedIndices?: Set<number>
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [p.longitude, p.latitude],
      },
      properties: {
        index: i,
        source: p.source,
        flagged: flaggedIndices ? flaggedIndices.has(i) : false,
        ...p,
      },
    })),
  };
}

export const OccurrenceMap = React.memo(function OccurrenceMap({
  points,
  flaggedIndices,
}: OccurrenceMapProps) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<MapRef | null>(null);
  const [popupInfo, setPopupInfo] = useState<{
    longitude: number;
    latitude: number;
    properties: Record<string, unknown>;
    index: number;
  } | null>(null);

  const geojson = useMemo(
    () => buildGeoJSON(points, flaggedIndices),
    [points, flaggedIndices]
  );

  const mapStyle = resolvedTheme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    const map = mapRef.current;
    const coords = points.map((p) => [p.longitude, p.latitude] as [number, number]);
    const bounds = geodesicBounds(coords, 5);
    map.fitBounds(bounds, { padding: 30, maxZoom: 12 });
  }, [points]);

  return (
    <div className="rounded-lg border border-sdm-border overflow-hidden h-[50vh]">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        onClick={(e) => {
          if (e.features && e.features.length > 0) {
            const feat = e.features[0];
            const props = feat.properties as Record<string, unknown>;
            setPopupInfo({
              longitude: (feat.geometry as Point).coordinates[0],
              latitude: (feat.geometry as Point).coordinates[1],
              properties: props,
              index: props.index as number,
            });
          }
        }}
        interactiveLayerIds={["occurrences-circles"]}
        cursor="pointer"
      >
        <Source id="occurrences" type="geojson" data={geojson}>
          <Layer
            id="occurrences-circles"
            type="circle"
            paint={{
              "circle-color": [
                "case",
                ["get", "flagged"],
                "#ef4444",
                "#3b82f6",
              ],
              "circle-radius": 5,
              "circle-opacity": 0.7,
              "circle-stroke-width": 1,
              "circle-stroke-color": [
                "case",
                ["get", "flagged"],
                "#dc2626",
                "#2563eb",
              ],
            }}
          />
        </Source>
        {popupInfo && (
          <Popup
            longitude={popupInfo.longitude}
            latitude={popupInfo.latitude}
            anchor="bottom"
            closeButton
            onClose={() => setPopupInfo(null)}
            offset={8}
          >
            <div className="text-sm space-y-1">
              <div>
                <strong>Source:</strong>{" "}
                {(popupInfo.properties.source as string) || "Unknown"}
              </div>
              <div>
                <strong>Status:</strong>{" "}
                <span
                  className={
                    popupInfo.properties.flagged
                      ? "text-red-600 font-semibold"
                      : "text-blue-600"
                  }
                >
                  {popupInfo.properties.flagged ? "Flagged" : "Clean"}
                </span>
              </div>
              {Object.entries(popupInfo.properties)
                .filter(
                  ([key]) =>
                    !["longitude", "latitude", "source", "flagged", "index"].includes(key)
                )
                .slice(0, 3)
                .map(([key, value]) => (
                  <div key={key}>
                    <strong>{key}:</strong> {String(value ?? "null")}
                  </div>
                ))}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
});

export { OccurrenceMap as default }
