"use client";

import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useTheme } from "next-themes";
import L from "leaflet";
import { useEffect, useState } from "react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface SuitabilityMapProps {
  outputFiles: Record<string, string> | null;
}

export function SuitabilityMap({ outputFiles }: SuitabilityMapProps) {
  const { theme } = useTheme();
  const [pngUrl, setPngUrl] = useState<string | null>(null);

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
        <MapContainer
          center={[-25, 135]}
          zoom={4}
          className="h-full w-full"
        >
          <TileLayer
            url={
              theme === "dark"
                ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            }
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          <ImageOverlay url={pngUrl} />
        </MapContainer>
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

function ImageOverlay({ url }: { url: string }) {
  const map = useMap();

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const bounds = L.latLngBounds(
        [-44, 112],
        [-10, 154]
      );
      L.imageOverlay(url, bounds, { opacity: 0.7 }).addTo(map);
      map.fitBounds(bounds);
    };
    img.src = url;
  }, [url, map]);

  return null;
}
