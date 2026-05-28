"use client";

import { useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { RasterMap } from "./raster-map";
import { apiPost } from "@/services/api";
import { X } from "lucide-react";

const TITILER_URL = process.env.NEXT_PUBLIC_TITILER_URL || "http://localhost:9000";

// SDM colormap: suitability 0→1 mapped to integer keys 0→255 for TiTiler
const SDM_COLORMAP_JSON = JSON.stringify({
  "0": [10, 22, 36, 255],
  "28": [18, 50, 71, 255],
  "57": [21, 84, 93, 255],
  "85": [31, 138, 112, 255],
  "113": [89, 193, 116, 255],
  "142": [198, 214, 91, 255],
  "170": [243, 196, 90, 255],
  "199": [242, 138, 60, 255],
  "227": [227, 75, 53, 255],
  "255": [165, 30, 59, 255],
});

function encodeColormap(): string {
  return encodeURIComponent(SDM_COLORMAP_JSON);
}

function buildTileUrl(tifPath: string): string {
  const colormapEncoded = encodeColormap();
  const dataUrlEncoded = encodeURIComponent(tifPath.replace("/app/outputs/", "/data/outputs/"));
  return `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${dataUrlEncoded}&tilesize=256&resampling=bilinear&reproject=bilinear&rescale=0,1&colormap=${colormapEncoded}`;
}

interface SuitabilityMapProps {
  outputFiles: Record<string, string> | null;
  projectionExtent?: number[] | null;
  runId?: string;
}

export function SuitabilityMap({ outputFiles, projectionExtent, runId }: SuitabilityMapProps) {
  const { theme } = useTheme();
  const [shapResult, setShapResult] = useState<any>(null);
  const [shapLoading, setShapLoading] = useState(false);
  const [shapCell, setShapCell] = useState<{ lng: number; lat: number } | null>(null);
  const [shapError, setShapError] = useState<string | null>(null);

  const handleCellClick = useCallback(async (lng: number, lat: number, _value: number | null) => {
    if (!runId) return;
    setShapCell({ lng, lat });
    setShapLoading(true);
    setShapError(null);
    setShapResult(null);
    try {
      const data = await apiPost<any>("/api/v1/diagnostics/shap/cell", {
        run_id: runId,
        longitude: lng,
        latitude: lat,
      });
      setShapResult(data);
    } catch (err: any) {
      setShapError(err?.message || "SHAP computation failed");
    } finally {
      setShapLoading(false);
    }
  }, [runId]);

  const tifUrl = outputFiles?.tif
    ? `/api/v1/results/file/download?path=${encodeURIComponent(outputFiles.tif)}`
    : null;

  const tileUrl = outputFiles?.tif_3857
    ? buildTileUrl(outputFiles.tif_3857)
    : outputFiles?.tif
    ? buildTileUrl(outputFiles.tif)
    : null;

  const extent: [number, number, number, number] | null =
    projectionExtent && projectionExtent.length >= 4 &&
    projectionExtent.every((v) => isFinite(v))
      ? [projectionExtent[0], projectionExtent[1], projectionExtent[2], projectionExtent[3]]
      : null;

  if (!extent || !tileUrl) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        Suitability raster not available. Check the output directory for the GeoTIFF.
      </div>
    );
  }

  // Convert [xmin, xmax, ymin, ymax] to MapLibre bounds format [west, south, east, north]
  const bounds: [number, number, number, number] = [
    extent[0], extent[2], extent[1], extent[3],
  ];

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="relative h-[60vh]">
        <RasterMap
          tileUrl={tileUrl}
          bounds={bounds}
          geotiffUrl={tifUrl ?? undefined}
          theme={theme}
          onCellClick={handleCellClick}
        />

        {shapLoading && shapCell && (
          <div className="absolute top-3 right-3 z-20 rounded-md bg-sdm-surface/90 border border-sdm-border/50 px-4 py-3 text-sm text-sdm-muted shadow-sm">
            Computing SHAP for ({shapCell.lng.toFixed(4)}, {shapCell.lat.toFixed(4)})...
          </div>
        )}

        {shapError && (
          <div className="absolute top-3 right-3 z-20 rounded-md bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-600 dark:text-red-400 shadow-sm">
            {shapError}
          </div>
        )}

        {shapResult?.available && shapCell && (
          <div className="absolute top-3 right-3 z-20 w-72 rounded-md bg-sdm-surface/95 border border-sdm-border/50 shadow-lg">
            <div className="flex items-center justify-between px-4 py-2 border-b border-sdm-border/50">
              <span className="text-xs font-semibold text-sdm-heading">SHAP explanation</span>
              <button onClick={() => { setShapResult(null); setShapCell(null); }} className="text-sdm-muted hover:text-sdm-text">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="px-4 py-2">
              <p className="text-xs text-sdm-muted mb-2">
                Cell: {shapCell.lng.toFixed(4)}, {shapCell.lat.toFixed(4)}
                {shapResult.prediction !== undefined && (
                  <> &middot; Suitability: <strong className="text-sdm-text">{shapResult.prediction.toFixed(3)}</strong></>
                )}
              </p>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {[...(shapResult.shap || [])]
                  .sort((a: any, b: any) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
                  .slice(0, 10)
                  .map((s: any) => (
                    <div key={s.variable} className="flex items-center justify-between text-xs">
                      <span className="text-sdm-muted truncate mr-2">{s.variable}</span>
                      <span className={`font-mono font-medium ${s.shap_value > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {s.shap_value > 0 ? '+' : ''}{s.shap_value.toFixed(4)}
                      </span>
                    </div>
                  ))}
              </div>
              <p className="text-[10px] text-sdm-muted mt-2 border-t border-sdm-border/50 pt-2">
                Positive = increases suitability relative to study-area mean
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-sdm-border flex items-center justify-between text-xs text-sdm-muted">
        <span>Suitability raster</span>
        {outputFiles?.tif && (
          <a href={tifUrl ?? ""} className="text-sdm-accent hover:underline">
            Download GeoTIFF (WGS84)
          </a>
        )}
      </div>
    </div>
  );
}
export { SuitabilityMap as default }
