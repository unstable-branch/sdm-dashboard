import { describe, expect, it } from "vitest";
import { buildBoundaryGeoJsonUrl } from "./boundary-url";

describe("buildBoundaryGeoJsonUrl", () => {
  it("uses an opaque boundary ID for custom result overlays", () => {
    expect(buildBoundaryGeoJsonUrl({
      maskBoundaryType: "custom",
      maskAssetId: "22222222-2222-4222-8222-222222222222",
    })).toBe("/api/v1/data/boundary/default?type=custom&boundaryAssetId=22222222-2222-4222-8222-222222222222");
  });

  it("uses public vocabulary for built-in result overlays", () => {
    expect(buildBoundaryGeoJsonUrl({
      maskBoundaryType: "admin0",
      maskCountry: "Australia",
      maskResolution: "10m",
    })).toBe("/api/v1/data/boundary/default?country=Australia&resolution=10m&type=admin0");
  });
});
