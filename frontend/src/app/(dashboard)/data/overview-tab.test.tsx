import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewTab } from "./overview-tab";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/services/api", () => ({ apiGet: mocks.apiGet }));

describe("OverviewTab canonical boundary summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith("/boundary/list")) return {
        boundaries: [{ boundaryAssetId: "22222222-2222-4222-8222-222222222222", contentSize: 2048, createdAt: "2026-09-20T00:00:00.000Z" }],
      };
      if (path.includes("/climate/scenarios")) return { scenarios: [] };
      if (path.includes("/occurrences/uploads")) return { uploads: [] };
      if (path.includes("/covariates/check")) return { covariates: {} };
      if (path.includes("/climate/check")) return { available: [], missing: [] };
      return {};
    });
  });

  it("renders boundary summaries without relying on server paths", async () => {
    render(<OverviewTab
      uploadResult={null}
      cleanResult={null}
      species=""
      recordCount={0}
      hasGbifCredentials={false}
      hasAlaCredentials={false}
      climateRes={10}
      climateBiovars={[1]}
      workspaceFileCount={0}
      onTabChange={vi.fn()}
    />);

    expect(await screen.findByText("Boundary 22222222")).toBeInTheDocument();
  });
});
