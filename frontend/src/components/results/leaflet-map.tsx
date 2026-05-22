"use client";

import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface LeafletMapProps {
  pngUrl: string;
  theme: string | undefined;
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

export default function LeafletMap({ pngUrl, theme }: LeafletMapProps) {
  return (
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
  );
}