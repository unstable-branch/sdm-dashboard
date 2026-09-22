import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoundaryTab } from "./boundary-tab";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/services/api", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiUpload: vi.fn(),
}));

describe("BoundaryTab canonical asset contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockResolvedValue({ success: true });
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith("/boundary/list")) return {
        boundaries: [{
          boundaryAssetId: "22222222-2222-4222-8222-222222222222",
          contentSize: 2048,
          createdAt: "2026-09-20T00:00:00.000Z",
        }],
      };
      if (path.endsWith("/boundary/countries")) return { countries: [] };
      return {};
    });
  });

  it("renders and deletes boundaries only by opaque asset ID", async () => {
    render(<BoundaryTab />);

    expect(await screen.findByText("Boundary 22222222")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Delete boundary"));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith(
      "/api/v1/data/boundary/delete/22222222-2222-4222-8222-222222222222",
      {},
    ));
  });
});
