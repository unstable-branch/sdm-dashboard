"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type Coords = [[number, number], [number, number], [number, number], [number, number]];

interface SuitabilityMapProps {
  outputFiles: Record<string, string> | null;
  projectionExtent?: number[] | null;
}

function parseExtent(extent: number[] | undefined | null): Coords | null {
  if (!extent || extent.length < 4) return null;
  const [xmin, xmax, ymin, ymax] = extent;
  if (!isFinite(xmin) || !isFinite(xmax) || !isFinite(ymin) || !isFinite(ymax)) return null;
  return [
    [xmin, ymax],
    [xmax, ymax],
    [xmax, ymin],
    [xmin, ymin],
  ];
}

function MapPlaceholder() {
  return (
    <div className="h-[60vh] rounded-lg border border-sdm-border bg-sdm-surface flex items-center justify-center text-sdm-muted">
      Loading map...
    </div>
  );
}

const DynamicMap = dynamic(() => import("./maplibre-map"), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

export function SuitabilityMap({ outputFiles, projectionExtent }: SuitabilityMapProps) {
  const { theme } = useTheme();
  const [pngUrl, setPngUrl] = useState<string | null>(null);

  const coords = parseExtent(projectionExtent);

  useEffect(() => {
    if (outputFiles?.png) {
      setPngUrl(`/api/v1/results/file/${encodeURIComponent(outputFiles.png)}`);
    }
  }, [outputFiles]);

  if (!pngUrl) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        Suitability map image not available. Check the output directory for the GeoTIFF.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="relative h-[60vh]">
        <DynamicMap pngUrl={pngUrl} theme={theme} coordinates={coords ?? undefined} />
      </div>
      <div className="px-4 py-2 border-t border-sdm-border flex items-center justify-between text-xs text-sdm-muted">
        <span>Suitability raster</span>
        {outputFiles?.tif && (
          <a href={`/api/v1/results/file/${encodeURIComponent(outputFiles.tif)}`} className="text-sdm-accent hover:underline">
            Download GeoTIFF
          </a>
        )}
      </div>
    </div>
  );
}
