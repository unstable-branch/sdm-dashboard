"use client";

import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { useTheme } from "next-themes";
import L from "leaflet";
import { useEffect } from "react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

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

function FitBounds({ points }: { points: OccurrencePoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(
      points.map((p) => [p.latitude, p.longitude] as [number, number])
    );
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [points, map]);

  return null;
}

export function OccurrenceMap({ points, flaggedIndices }: OccurrenceMapProps) {
  const { theme } = useTheme();

  return (
    <div className="rounded-lg border border-sdm-border overflow-hidden h-[50vh]">
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
        <FitBounds points={points} />
        {points.map((point, i) => (
          <CircleMarker
            key={i}
            center={[point.latitude, point.longitude]}
            radius={5}
            fillColor={flaggedIndices?.has(i) ? "#ef4444" : "#3b82f6"}
            fillOpacity={0.7}
            color={flaggedIndices?.has(i) ? "#dc2626" : "#2563eb"}
            weight={1}
          >
            <Popup>
              <div className="text-sm space-y-1">
                <div><strong>Source:</strong> {point.source || "Unknown"}</div>
                <div><strong>Status:</strong>{" "}
                  <span className={flaggedIndices?.has(i) ? "text-red-600 font-semibold" : "text-blue-600"}>
                    {flaggedIndices?.has(i) ? "Flagged" : "Clean"}
                  </span>
                </div>
                {Object.entries(point)
                  .filter(([key]) => !["longitude", "latitude", "source"].includes(key))
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <div key={key}><strong>{key}:</strong> {String(value ?? "null")}</div>
                  ))}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
