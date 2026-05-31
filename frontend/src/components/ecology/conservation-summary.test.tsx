import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConservationSummary } from "./conservation-summary";

global.fetch = vi.fn();

const mockEcologyData = {
  run_id: "run-1",
  species: "Test species",
  model_id: "glm",
  eoo_aoo: {
    available: true,
    eoo_km2: 15000,
    aoo_km2: 500,
    iucn_category: "VU",
  },
  aoa: {
    available: true,
    png: "outputs/jobs/run-1/aoa.png",
  },
  climate_matching: {
    available: false,
    message: "Climate matching not enabled for this run",
  },
  mess: {
    available: true,
    mess_tif: "outputs/jobs/run-1/mess.tif",
    mod_tif: "outputs/jobs/run-1/mod.tif",
    pct_extrapolation: 12.5,
  },
  niche_overlap: null,
};

describe("ConservationSummary", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockEcologyData),
    } as Response);
  });

  it("shows loading state initially", () => {
    render(<ConservationSummary runId="run-1" />);
    expect(screen.getByText(/Loading ecology data/i)).toBeInTheDocument();
  });

  it("displays species name after loading", async () => {
    render(<ConservationSummary runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText("Test species")).toBeInTheDocument();
    });
  });

  it("shows EOO/AOO metrics when available", async () => {
    render(<ConservationSummary runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Extent & Area of Occurrence/i)).toBeInTheDocument();
      expect(screen.getByText(/15,000 km²/i)).toBeInTheDocument();
      expect(screen.getByText(/500 km²/i)).toBeInTheDocument();
    });
  });

  it("shows IUCN category badge", async () => {
    render(<ConservationSummary runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText("VU")).toBeInTheDocument();
    });
  });

  it("shows MESS extrapolation percentage", async () => {
    render(<ConservationSummary runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText(/12.5%/i)).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Run not found" }),
    } as Response);

    render(<ConservationSummary runId="run-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Run not found/i)).toBeInTheDocument();
    });
  });
});
