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

  it("does not use another recent upload count when active cleaning count is unknown", async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith("/boundary/list")) return { boundaries: [] };
      if (path.includes("/climate/scenarios")) return { scenarios: [] };
      if (path.includes("/occurrences/uploads")) return { uploads: [{ file_id: "recent", file_name: "other.csv", file_size: 1, n_rows: 200, cleaned: true, cleaned_valid_records: 200, modified_at: null }] };
      if (path.includes("/covariates/check")) return { covariates: {} };
      if (path.includes("/climate/check")) return { available: [], missing: [] };
      return {};
    });

    render(<OverviewTab
      uploadResult={{ file_id: "active", file_name: "active.csv", n_rows: 100 } as any}
      cleanResult={{ valid_records: null } as any}
      species=""
      recordCount={100}
      hasGbifCredentials={false}
      hasAlaCredentials={false}
      climateRes={10}
      climateBiovars={[1]}
      workspaceFileCount={0}
      onTabChange={vi.fn()}
    />);

    expect(await screen.findAllByText("Count unavailable")).not.toHaveLength(0);
    expect(screen.getByText("Records:").parentElement).toHaveTextContent("Count unavailable");
    expect(screen.queryByText("200 valid records")).not.toBeInTheDocument();
    expect(screen.getByText("other.csv")).toBeInTheDocument();
  });

  it("keeps an active zero cleaned count instead of using recent totals", async () => {
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith("/boundary/list")) return { boundaries: [] };
      if (path.includes("/climate/scenarios")) return { scenarios: [] };
      if (path.includes("/occurrences/uploads")) return { uploads: [{ file_id: "recent", file_name: "other.csv", file_size: 1, n_rows: 200, cleaned: true, cleaned_valid_records: 200, modified_at: null }] };
      if (path.includes("/covariates/check")) return { covariates: {} };
      if (path.includes("/climate/check")) return { available: [], missing: [] };
      return {};
    });

    render(<OverviewTab
      uploadResult={{ file_id: "active", file_name: "active.csv", n_rows: 100 } as any}
      cleanResult={{ valid_records: 0 } as any}
      species=""
      recordCount={100}
      hasGbifCredentials={false}
      hasAlaCredentials={false}
      climateRes={10}
      climateBiovars={[1]}
      workspaceFileCount={0}
      onTabChange={vi.fn()}
    />);

    expect(await screen.findByText("0", { selector: ".font-medium.text-sdm-text" })).toBeInTheDocument();
    expect(screen.queryByText("200 valid records")).not.toBeInTheDocument();
    expect(screen.getByText("other.csv")).toBeInTheDocument();
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
