"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useTheme } from "next-themes";
import type { ViewState } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import dynamic from "next/dynamic";
import type { OutputFiles } from "@/services/types";
import { extentToCoordinates, extentToViewState, parseTileZoom, DEFAULT_TILE_ZOOM_MIN, DEFAULT_TILE_ZOOM_MAX, LAYER_IDS } from "@/lib/map-utils";

interface SuitabilityMapProps {
  outputFiles: OutputFiles | null;
  runId: string;
  initialViewState?: Partial<ViewState>;
  coordinates?: [[number, number], [number, number], [number, number], [number, number]];
  projectionExtent?: number[] | null;
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
  boundaryGeoJSON?: FeatureCollection | null;
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
  const finalCoordinates = useMemo(
    () => coordinates || extentToCoordinates(projectionExtent),
    [coordinates, projectionExtent]
  );
  const finalViewState = useMemo(
    () => initialViewState || extentToViewState(projectionExtent),
    [initialViewState, projectionExtent]
  );
  const tileBounds: [number, number, number, number] | undefined = useMemo(
    () => projectionExtent
      ? [projectionExtent[0], projectionExtent[2], projectionExtent[1], projectionExtent[3]]
      : finalCoordinates
      ? [finalCoordinates[0][0], finalCoordinates[2][1], finalCoordinates[1][0], finalCoordinates[0][1]]
      : undefined,
    [projectionExtent, finalCoordinates]
  );
  const { resolvedTheme } = useTheme();
  const safeTheme = resolvedTheme ?? "dark";
  const baseVisibility: Record<string, boolean> = useMemo(() => ({
    [LAYER_IDS.SUITABILITY]: true,
    [LAYER_IDS.EOO]: !!eooGeoJSON,
    [LAYER_IDS.AOO]: !!aooGeoJSON,
    [LAYER_IDS.BOUNDARY]: false,
    [LAYER_IDS.EXTENT]: true,
  }), [eooGeoJSON, aooGeoJSON]);

  const [userToggles, setUserToggles] = useState<Record<string, boolean>>({});
  const layerVisibility: Record<string, boolean> = useMemo(() => {
    return { ...baseVisibility, ...userToggles };
  }, [baseVisibility, userToggles]);

  useEffect(() => {
    setUserToggles({});
  }, [runId]);
  const [basemap, setBasemap] = useState<"light" | "dark">("dark");

  const onToggleLayer = useCallback((layer: string) => {
    setUserToggles((prev) => {
      const current = layer in prev ? prev[layer] : baseVisibility[layer];
      return { ...prev, [layer]: !current };
    });
  }, [baseVisibility]);

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

  const safeTileZoomMin = parseTileZoom(outputFiles?.tile_zoom_min, DEFAULT_TILE_ZOOM_MIN);
  const safeTileZoomMax = parseTileZoom(outputFiles?.tile_zoom_max, DEFAULT_TILE_ZOOM_MAX);

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="relative h-[60vh]">
        <DynamicMap
          runId={runId}
          theme={safeTheme}
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
              const tifPath = outputFiles.tif!;
              const a = document.createElement("a");
              a.href = `/api/v1/results/file/download?path=${encodeURIComponent(tifPath)}`;
              a.download = tifPath.split("/").pop() || "suitability.tif";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
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
