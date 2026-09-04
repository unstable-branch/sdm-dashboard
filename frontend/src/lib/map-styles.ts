// CARTO vector tile basemaps — free, no API key.
// CARTO Streets v1 (MVT/PBF) served from tiles.basemaps.cartocdn.com.
// GL style JSON endpoints support CORS and cache for 180 days.
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; ' +
  '<a href="https://www.openstreetmap.org/copyright">OSM</a> contributors';

export const LIGHT_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const DARK_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export { CARTO_ATTRIBUTION as BASEMAP_ATTRIBUTION };
