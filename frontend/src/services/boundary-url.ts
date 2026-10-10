export function buildBoundaryGeoJsonUrl(config: Record<string, unknown>): string | null {
  const boundaryType = config.maskBoundaryType as string | undefined;
  if (boundaryType === "custom") {
    const boundaryAssetId = config.maskAssetId as string | undefined;
    if (!boundaryAssetId) return null;
    const params = new URLSearchParams({ type: "custom", boundaryAssetId });
    return `/api/v1/data/boundary/default?${params.toString()}`;
  }
  if (!boundaryType) return "/api/v1/data/boundary/default";

  const params = new URLSearchParams();
  const country = config.maskCountry as string | undefined;
  const resolution = config.maskResolution as string | undefined;
  if (country && country !== "all") params.set("country", country);
  if (resolution && resolution !== "auto") params.set("resolution", resolution);
  params.set("type", boundaryType);
  return `/api/v1/data/boundary/default?${params.toString()}`;
}
