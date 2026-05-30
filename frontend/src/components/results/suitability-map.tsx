"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useState, useRef } from "react";
import type { ViewState } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import { fetchWithAuth } from "@/services/api";

interface SuitabilityMapProps {
  outputFiles: Record<string, string> | null;
  initialViewState?: Partial<ViewState>;
  coordinates?: [[number, number], [number, number], [number, number], [number, number]];
  eooGeoJSON?: FeatureCollection | null;
  aooGeoJSON?: FeatureCollection | null;
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

export function SuitabilityMap({ outputFiles, initialViewState, coordinates, eooGeoJSON, aooGeoJSON }: SuitabilityMapProps) {
  const { theme } = useTheme();
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!outputFiles?.png) {
      setPngUrl(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const path = `/api/v1/results/file/${encodeURIComponent(outputFiles.png)}`;
    fetchWithAuth(path)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setPngUrl(url);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("[SuitabilityMap] Failed to load PNG:", err);
        if (!cancelled) { setPngUrl(null); setLoading(false); }
      });
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [outputFiles]);

  if (loading) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
        <MapPlaceholder label="Loading suitability raster..." />
      </div>
    );
  }

  if (!pngUrl) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        Suitability map image not available.
        {outputFiles?.png && (
          <div className="mt-2 text-xs">
            <img
              src={`/api/v1/results/file/${encodeURIComponent(outputFiles.png)}`}
              alt=""
              className="max-w-full h-auto border border-sdm-border rounded"
              onError={(e) => {
                const err = (e.target as HTMLImageElement).src
                  ? `Failed to load: ${(e.target as HTMLImageElement).src.slice(0, 80)}...`
                  : "Failed to load image";
                (e.target as HTMLImageElement).style.display = "none";
                const next = (e.target as HTMLImageElement).nextElementSibling;
                if (next) next.textContent = err;
              }}
            />
            <noscript>Enable JavaScript for authenticated image loading.</noscript>
          </div>
        )}
      </div>
    );
  }

  if (!coordinates) {
    return (
      <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center text-sdm-muted">
        Map extent not available.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sdm-border bg-sdm-surface overflow-hidden">
      <div className="relative h-[60vh]">
        <DynamicMap pngUrl={pngUrl} theme={theme} initialViewState={initialViewState} coordinates={coordinates} eooGeoJSON={eooGeoJSON} aooGeoJSON={aooGeoJSON} />
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
