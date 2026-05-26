"use client";

import { useTheme } from "next-themes";
import { RasterMap } from "./raster-map";

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

function buildTileUrl(tif4326Path: string): string {
  const colormapEncoded = encodeColormap();
  // Serve the 4326 TIFF directly with on-the-fly reprojection to Web Mercator
  const dataUrlEncoded = encodeURIComponent(tif4326Path.replace("/app/outputs/", "/data/outputs/"));
  return `${TITILER_URL}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${dataUrlEncoded}&tilesize=256&resampling=bilinear&reproject=bilinear&rescale=0,1&colormap=${colormapEncoded}`;
}

interface SuitabilityMapProps {
  outputFiles: Record<string, string> | null;
  projectionExtent?: number[] | null;
}

export function SuitabilityMap({ outputFiles, projectionExtent }: SuitabilityMapProps) {
  const { theme } = useTheme();

  const tifUrl = outputFiles?.tif
    ? `/api/v1/results/file/download?path=${encodeURIComponent(outputFiles.tif)}`
    : null;

  const tileUrl = outputFiles?.tif
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
        />
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
