"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Map, Source, Layer, Popup, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRasterData } from "@/hooks/useRasterData";
import { Loader2 } from "lucide-react";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const LIGHT_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: CARTO_ATTRIBUTION,
    },
  },
  layers: [
    { id: "carto-tiles", type: "raster" as const, source: "carto" },
  ],
};

const DARK_STYLE = {
  version: 8 as const,
  sources: {
    carto: {
      type: "raster" as const,
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution: CARTO_ATTRIBUTION,
    },
  },
  layers: [
    { id: "carto-tiles", type: "raster" as const, source: "carto" },
  ],
};

const LEGEND_STOPS = [
  { label: "0", color: "#0A1624" },
  { label: "0.25", color: "#1F8A70" },
  { label: "0.5", color: "#C6D65B" },
  { label: "0.75", color: "#F28A3C" },
  { label: "1", color: "#A51E3B" },
];

interface RasterMapProps {
  tileUrl: string | null;
  bounds: [number, number, number, number];
  geotiffUrl?: string;
  theme: string | undefined;
  onCellClick?: (lng: number, lat: number, value: number | null) => void;
}

export function RasterMap({ tileUrl, bounds, geotiffUrl, theme, onCellClick }: RasterMapProps) {
  const { data, loading, error } = useRasterData(geotiffUrl ?? null);
  const [hoverInfo, setHoverInfo] = useState<{ value: number; lng: number; lat: number } | null>(null);
  const [tileErrors, setTileErrors] = useState(0);
  const mapRef = useRef<MapRef>(null);
  const dataRef = useRef(data);
  const extentRef = useRef<[number, number, number, number] | null>(null);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    if (data?.bbox) {
      extentRef.current = data.bbox;
    }
  }, [data]);

  const [west, south, east, north] = bounds;
  const lngSpan = east - west;
  const latSpan = north - south;
  const initialZoom = Math.max(1, Math.min(10, Math.round(13 - Math.log2(Math.max(lngSpan, latSpan)))));
  const viewState = {
    longitude: (west + east) / 2,
    latitude: (north + south) / 2,
    zoom: initialZoom,
  };

  const fitBoundsToExtent = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.fitBounds(bounds, { padding: 40, maxZoom: 10, duration: 500 });
    }
  }, [bounds.join(",")]);

  const handleMouseMove = useCallback((evt: any) => {
    const d = dataRef.current;
    const ext = extentRef.current;
    if (!d || !ext) {
      setHoverInfo(null);
      return;
    }
    const { lng, lat } = evt.lngLat;
    const [xmin, xmax, ymin, ymax] = ext;
    const { width, height, data: raster } = d;

    if (lng < xmin || lng > xmax || lat < ymin || lat > ymax) {
      setHoverInfo(null);
      return;
    }

    const col = Math.floor(((lng - xmin) / (xmax - xmin)) * width);
    const row = Math.floor(((ymax - lat) / (ymax - ymin)) * height);

    if (col >= 0 && col < width && row >= 0 && row < height) {
      const val = raster[row * width + col];
      if (!isNaN(val) && val >= 0 && val <= 1) {
        setHoverInfo({ value: val, lng, lat });
        return;
      }
    }
    setHoverInfo(null);
  }, []);

  const handleClick = useCallback((evt: any) => {
    const d = dataRef.current;
    const ext = extentRef.current;
    if (!d || !ext || !onCellClick) return;
    const { lng, lat } = evt.lngLat;
    const [xmin, xmax, ymin, ymax] = ext;
    const { width, height, data: raster } = d;
    if (lng < xmin || lng > xmax || lat < ymin || lat > ymax) {
      onCellClick(lng, lat, null);
      return;
    }
    const col = Math.floor(((lng - xmin) / (xmax - xmin)) * width);
    const row = Math.floor(((ymax - lat) / (ymax - ymin)) * height);
    if (col >= 0 && col < width && row >= 0 && row < height) {
      const val = raster[row * width + col];
      onCellClick(lng, lat, (!isNaN(val) && val >= 0 && val <= 1) ? val : null);
    } else {
      onCellClick(lng, lat, null);
    }
  }, [onCellClick]);

  const handleMapError = useCallback((evt: any) => {
    if (evt?.error?.status === 404 || evt?.error?.status === 500) {
      setTileErrors((prev) => prev + 1);
    }
  }, []);

  if (!tileUrl) {
    return (
      <div className="h-full flex items-center justify-center text-sdm-muted">
        Suitability raster not available
      </div>
    );
  }

  const showRasterWarning = error || tileErrors > 5;

  return (
    <div className="relative h-full">
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-sdm-surface/60 rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        </div>
      )}
      {showRasterWarning && (
        <div className="absolute top-3 left-3 right-3 z-20 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {error
            ? `Raster data error: ${error}`
            : `Some map tiles failed to load (${tileErrors} errors). The basemap may be incomplete.`}
        </div>
      )}
      <Map
        ref={mapRef}
        initialViewState={viewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={theme === "dark" ? DARK_STYLE : LIGHT_STYLE}
        onLoad={fitBoundsToExtent}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onError={handleMapError}
        cursor={data ? "crosshair" : "grab"}
        maxZoom={18}
      >
        <Source
          id="suitability"
          type="raster"
          tiles={[tileUrl]}
          tileSize={256}
          bounds={[west, south, east, north]}
          minzoom={0}
          maxzoom={12}
        >
          <Layer
            id="suitability-overlay"
            type="raster"
            paint={{
              "raster-opacity": 0.7,
              "raster-resampling": "linear",
              "raster-fade-duration": 0,
            }}
          />
        </Source>
        {hoverInfo && (
          <Popup
            longitude={hoverInfo.lng}
            latitude={hoverInfo.lat}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={15}
          >
            <div className="text-xs font-mono">
              Suitability: <span className="font-bold">{hoverInfo.value.toFixed(3)}</span>
            </div>
          </Popup>
        )}
      </Map>
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md bg-sdm-surface/90 px-3 py-1.5 shadow-sm border border-sdm-border/50 text-xs text-sdm-muted">
        <div className="flex items-center gap-0.5">
          {LEGEND_STOPS.map((s, i) => (
            <div
              key={i}
              className="w-5 h-2.5"
              style={{ backgroundColor: s.color }}
              title={`${s.label}`}
            />
          ))}
        </div>
        <span className="ml-1">Suitability</span>
      </div>
    </div>
  );
}