"use client";

import { useState, useCallback } from "react";
import { useTheme } from "next-themes";
import type { ViewState } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import dynamic from "next/dynamic";
import { fetchWithAuth } from "@/services/api";

interface SuitabilityMapProps {
  outputFiles: Record<string, string> | null;
  runId: string;
  initialViewState?: Partial<ViewState>;
  coordinates?: [[number, number], [number, number], [number, number], [number, number]];
  projectionExtent?: number[] | null;
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
  boundaryGeoJSON?: FeatureCollection | null;
}

function extentToCoordinates(e?: number[] | null): [[number, number], [number, number], [number, number], [number, number]] | undefined {
  if (!e || e.length < 4) return undefined;
  return [[e[0], e[3]], [e[1], e[3]], [e[1], e[2]], [e[0], e[2]]];
}

function extentToViewState(e?: number[] | null): Partial<ViewState> | undefined {
  if (!e || e.length < 4) return undefined;
  const [xmin, xmax, ymin, ymax] = e;
  const maxSpan = Math.max(xmax - xmin, ymax - ymin);
  const zoom = maxSpan > 50 ? 4 : maxSpan > 20 ? 5 : maxSpan > 10 ? 6 : maxSpan > 5 ? 7 : 8;
  return { longitude: (xmin + xmax) / 2, latitude: (ymin + ymax) / 2, zoom };
}

function MapPlaceholder({ label }: { label?: string }) {
  return (
    <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">
      {label || "Loading map..."}
    </div>
  );
}

const DynamicMap = dynamic(() => import("./maplibre-map"), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

export function SuitabilityMap({ outputFiles, runId, initialViewState, coordinates, projectionExtent, eooGeoJSON, aooGeoJSON, boundaryGeoJSON }: SuitabilityMapProps) {
  const finalCoordinates = coordinates || extentToCoordinates(projectionExtent);
  const finalViewState = initialViewState || extentToViewState(projectionExtent);
  const tileBounds: [number, number, number, number] | undefined = projectionExtent
    ? [projectionExtent[0], projectionExtent[2], projectionExtent[1], projectionExtent[3]]
    : finalCoordinates
    ? [finalCoordinates[0][0], finalCoordinates[2][1], finalCoordinates[1][0], finalCoordinates[0][1]]
    : undefined;
  const { resolvedTheme } = useTheme();
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    suitability: true,
    eoo: true,
    aoo: true,
    boundary: false,
    extent: true,
  });
  const [basemap, setBasemap] = useState<"light" | "dark">("light");

  const onToggleLayer = useCallback((layer: string) => {
    setLayerVisibility((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const onToggleBasemap = useCallback(() => {
    setBasemap((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  if (!runId) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        Suitability map not available.
      </div>
    );
  }

  const rawZoomMin = outputFiles?.tile_zoom_min;
  const rawZoomMax = outputFiles?.tile_zoom_max;
  const tileZoomMin = rawZoomMin ? parseInt(rawZoomMin, 10) : 4;
  const tileZoomMax = rawZoomMax ? parseInt(rawZoomMax, 10) : 8;
  const safeTileZoomMin = !isNaN(tileZoomMin) ? tileZoomMin : 4;
  const safeTileZoomMax = !isNaN(tileZoomMax) ? tileZoomMax : 8;

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="relative h-[60vh]">
        <DynamicMap
          runId={runId}
          theme={resolvedTheme}
          initialViewState={finalViewState}
          coordinates={finalCoordinates}
          tileZoomMin={safeTileZoomMin}
          tileZoomMax={safeTileZoomMax}
          tileBounds={tileBounds}
          eooGeoJSON={eooGeoJSON}
          aooGeoJSON={aooGeoJSON}
          boundaryGeoJSON={boundaryGeoJSON}
          layerVisibility={layerVisibility}
          onToggleLayer={onToggleLayer}
          basemap={basemap}
          onToggleBasemap={onToggleBasemap}
        />
      </div>
      <div className="px-4 py-2 border-t border-sdm-border flex items-center justify-between text-xs text-sdm-muted">
        <span>Suitability raster</span>
        {outputFiles?.tif && (
          <button
            onClick={() => {
              fetchWithAuth(`/api/v1/results/file/${encodeURIComponent(outputFiles.tif)}`)
                .then((res) => {
                  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
                  return res.blob();
                })
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = outputFiles.tif.split("/").pop() || "suitability.tif";
                  a.click();
                  URL.revokeObjectURL(url);
                })
                .catch((err) => {
                  console.error("[SuitabilityMap] Download TIFF failed:", err);
                });
            }}
            className="text-sdm-accent hover:underline cursor-pointer bg-transparent border-none text-xs"
          >
            Download GeoTIFF
          </button>
        )}
      </div>
    </div>
  );
}
export { SuitabilityMap as default }
