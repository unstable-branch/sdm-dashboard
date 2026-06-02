import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SuitabilityMap } from "./suitability-map";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

const mockMapComponent = vi.fn(() => <div data-testid="maplibre-map" />);
vi.mock("./maplibre-map", () => ({
  default: (props: Record<string, unknown>) => mockMapComponent(props),
}));

const mockCoordinates: [[number, number], [number, number], [number, number], [number, number]] =
  [[110, -10], [155, -10], [155, -45], [110, -45]];

describe("SuitabilityMap", () => {
  it("shows not available when runId is missing", () => {
    render(<SuitabilityMap outputFiles={{}} />);
    expect(screen.getByText("Suitability map not available.")).toBeInTheDocument();
  });

  it("renders map even when coordinates are missing", () => {
    render(<SuitabilityMap outputFiles={{}} runId="abc-123" />);
    expect(screen.getByText("Suitability raster")).toBeInTheDocument();
  });

  it("renders download button when tif is available", () => {
    render(
      <SuitabilityMap
        outputFiles={{ tif: "output.tif" }}
        runId="abc-123"
        coordinates={mockCoordinates}
      />
    );
    expect(screen.getByText("Download GeoTIFF")).toBeInTheDocument();
  });

  it("renders suitability raster label", () => {
    render(
      <SuitabilityMap
        outputFiles={{}}
        runId="abc-123"
        coordinates={mockCoordinates}
      />
    );
    expect(screen.getByText("Suitability raster")).toBeInTheDocument();
  });
});
