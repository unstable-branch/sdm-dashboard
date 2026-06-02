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
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
  projectionExtent?: number[] | null;
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

export function SuitabilityMap({ outputFiles, runId, initialViewState, coordinates, eooGeoJSON, aooGeoJSON }: SuitabilityMapProps) {
  const { theme } = useTheme();

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
        <DynamicMap runId={runId} theme={theme} initialViewState={initialViewState} coordinates={coordinates} tileZoomMin={safeTileZoomMin} tileZoomMax={safeTileZoomMax} eooGeoJSON={eooGeoJSON} aooGeoJSON={aooGeoJSON} />
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
