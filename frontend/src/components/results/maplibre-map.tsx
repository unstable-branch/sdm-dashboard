"use client";

import { Map, Source, Layer } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

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
    {
      id: "carto-tiles",
      type: "raster" as const,
      source: "carto",
    },
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
    {
      id: "carto-tiles",
      type: "raster" as const,
      source: "carto",
    },
  ],
};

type Coords = [[number, number], [number, number], [number, number], [number, number]];

const DEFAULT_BOUNDS = {
  longitude: 133,
  latitude: -27,
  zoom: 4,
};

const DEFAULT_COORDS: Coords = [
  [112, -10],
  [154, -10],
  [154, -44],
  [112, -44],
];

interface MaplibreMapProps {
  pngUrl: string;
  theme: string | undefined;
  coordinates?: Coords;
}

export default function MaplibreMap({ pngUrl, theme, coordinates }: MaplibreMapProps) {
  const mapStyle = theme === "dark" ? DARK_STYLE : LIGHT_STYLE;

  const coords = coordinates ?? DEFAULT_COORDS;
  // Compute view state center from the extent corners
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  const viewState = {
    longitude: (Math.min(...lons) + Math.max(...lons)) / 2,
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    zoom: 4,
  };

  return (
    <Map
      initialViewState={viewState}
      style={{ width: "100%", height: "100%" }}
      mapStyle={mapStyle}
      maxZoom={18}
    >
      <Source
        id="suitability"
        type="image"
        url={pngUrl}
        coordinates={coords}
      >
        <Layer
          id="suitability-overlay"
          type="raster"
          paint={{ "raster-opacity": 0.7 }}
        />
      </Source>
    </Map>
  );
}