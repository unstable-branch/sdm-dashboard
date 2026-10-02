import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyntheticStressPanel } from "./synthetic-stress-panel";

const mocks = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("@/services/api", () => ({ apiPost: mocks.apiPost }));

const generated = {
  file_id: "asset-file-1",
  rawAssetId: "canonical-asset-1",
  file_name: "synthetic.csv",
  n_species: 3,
  n_records: 6000,
  n_errors: 0,
  error_rate: 0,
  species_names: ["Species one", "Species two", "Species three"],
  sigmas: [],
  level: "small",
  target_architecture: "DNN_Small",
  raster_cells: 1200,
  message: "Synthetic dataset created",
};

describe("SyntheticStressPanel workspace completion feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockResolvedValue(generated);
  });

  it("shows completion only after workspace add succeeds", async () => {
    const onAddToWorkspace = vi.fn();
    render(<SyntheticStressPanel onAddToWorkspace={onAddToWorkspace} />);

    fireEvent.click(screen.getByRole("button", { name: "DNN_Small" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate & add to workspace/ }));

    expect(await screen.findByText("Added to workspace")).toBeInTheDocument();
    expect(onAddToWorkspace).toHaveBeenCalledWith(expect.objectContaining({ rawAssetId: "canonical-asset-1" }), expect.any(String));
  });

  it("preserves generated asset details but reports workspace-add failure", async () => {
    render(<SyntheticStressPanel onAddToWorkspace={() => { throw new Error("workspace update failed"); }} />);

    fireEvent.click(screen.getByRole("button", { name: "DNN_Small" }));
    fireEvent.click(screen.getByRole("button", { name: /Generate & add to workspace/ }));

    expect(await screen.findByText("Generated, but not added to workspace: workspace update failed")).toBeInTheDocument();
    expect(screen.getByText("Synthetic dataset created")).toBeInTheDocument();
    expect(screen.queryByText("Added to workspace")).not.toBeInTheDocument();
    expect(screen.getAllByText("3 species")).toHaveLength(2);
  });
});
