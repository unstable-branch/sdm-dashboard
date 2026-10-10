"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useTheme } from "next-themes";
import type { ViewState } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import dynamic from "next/dynamic";
import type { OutputFiles } from "@/services/types";
import { extentToCoordinates, extentToViewState, parseTileZoom, DEFAULT_TILE_ZOOM_MIN, DEFAULT_TILE_ZOOM_MAX, LAYER_IDS } from "@/lib/map-utils";
import { apiDownload } from "@/services/api";
import { Info } from "lucide-react";

interface SuitabilityMapProps {
  outputFiles: OutputFiles | null;
  runId: string;
  bandName?: string;
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

export function SuitabilityMap({ outputFiles, runId, bandName, initialViewState, coordinates, projectionExtent, eooGeoJSON, aooGeoJSON, boundaryGeoJSON }: SuitabilityMapProps) {
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
    [LAYER_IDS.EOO]: false,
    [LAYER_IDS.AOO]: !!aooGeoJSON,
    [LAYER_IDS.BOUNDARY]: false,
    [LAYER_IDS.EXTENT]: false,
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
  const tilesNotPreGenerated = outputFiles?.tile_zoom_max == null;

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="relative h-[60vh]">
        <div className="pointer-events-none absolute bottom-10 left-3 z-10 rounded-md border border-sdm-border bg-sdm-surface/90 px-3 py-2 shadow-sm backdrop-blur">
          <div className="text-[11px] font-medium text-sdm-heading">Habitat suitability</div>
          <div
            className="mt-1.5 h-2 w-40 rounded-sm"
            style={{ background: "linear-gradient(90deg, rgba(21,84,93,0.35), #1F8A70, #59C174, #C6D65B, #F3C45A, #F28A3C, #E34B35, #A51E3B)" }}
          />
          <div className="mt-1 flex justify-between text-[10px] text-sdm-muted tabular-nums">
            <span>Low</span><span>High</span>
          </div>
        </div>
        <DynamicMap
          runId={runId}
          band={bandName || "suitability"}
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
        <span className="flex items-center gap-1.5">
          Suitability raster
          {tilesNotPreGenerated && (
            <span className="inline-flex items-center gap-1 text-sdm-muted/80" title="Tiles are rendered on demand from the GeoTIFF">
              <Info className="h-3 w-3" /> rendered on demand
            </span>
          )}
        </span>
        {outputFiles?.tif && (
          <button
            onClick={() => {
              const tifPath = outputFiles.tif!;
              apiDownload(`/api/v1/results/file/download?path=${encodeURIComponent(tifPath)}`, tifPath.split("/").pop() || "suitability.tif");
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
