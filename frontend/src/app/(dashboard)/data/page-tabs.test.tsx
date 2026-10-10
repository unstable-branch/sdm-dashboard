import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSDMStore } from "@/stores/sdm-store";
import DataPage from "./page";

const mocks = vi.hoisted(() => ({ search: "tab=upload", replace: vi.fn(), push: vi.fn(), apiGet: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/services/api", () => ({ apiGet: mocks.apiGet, apiUpload: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (select: (state: { settings: object; fetchSettings: () => void }) => unknown) => select({ settings: {}, fetchSettings: () => {} }),
}));
vi.mock("./upload-tab", () => ({ UploadTab: () => <div>Upload fixture</div> }));
vi.mock("./overview-tab", () => ({ OverviewTab: () => <div>Overview fixture</div> }));
vi.mock("./climate-tab", () => ({ ClimateTab: (props: { climateSource: string; climateRes: number; availableBiovars: Set<number>; onSetClimateSource: (value: "worldclim" | "chelsa") => void; onSetClimateRes: (value: number) => void }) => <div>Climate fixture <span data-testid="current-climate">{props.climateSource}/{props.climateRes}</span><span data-testid="available-biovars">{[...props.availableBiovars].join(",")}</span><button onClick={() => { props.onSetClimateSource("chelsa"); props.onSetClimateRes(0.5); }}>CHELSA</button><button onClick={() => { props.onSetClimateSource("worldclim"); props.onSetClimateRes(10); }}>WorldClim</button></div> }));
vi.mock("./covariate-tab", () => ({ CovariateTab: () => <div>Covariate fixture</div> }));
vi.mock("./boundary-tab", () => ({ BoundaryTab: () => <div>Boundary fixture</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  useSDMStore.getState().reset();
  mocks.search = "tab=upload";
  mocks.apiGet.mockResolvedValue({});
});

describe("Data controlled tab associations", () => {
  it("keeps climate availability owned by the current source and resolution", async () => {
    const checks: Array<{ url: string; resolve: (value: { available: number[]; permission_issues: string[] }) => void; reject: (error: Error) => void }> = [];
    mocks.search = "tab=climate";
    mocks.apiGet.mockImplementation((url: string) => {
      if (!url.includes("/climate/check?")) return Promise.resolve({ scenarios: [], uploads: [] });
      return new Promise((resolve, reject) => checks.push({ url, resolve, reject }));
    });
    render(<DataPage />);
    await act(async () => { await Promise.resolve(); });
    expect(checks).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "CHELSA" }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "WorldClim" }));
    await act(async () => { await Promise.resolve(); });
    expect(checks.map((check) => check.url)).toEqual([
      expect.stringContaining("source=worldclim&res=10"),
      expect.stringContaining("source=chelsa&res=0.5"),
      expect.stringContaining("source=worldclim&res=10"),
    ]);
    await act(async () => { checks[2].resolve({ available: [1, 2], permission_issues: [] }); await Promise.resolve(); });
    expect(screen.getByTestId("available-biovars")).toHaveTextContent("1,2");
    await act(async () => { checks[1].resolve({ available: [9], permission_issues: ["stale warning"] }); await Promise.resolve(); });
    expect(screen.getByTestId("current-climate")).toHaveTextContent("worldclim/10");
    expect(screen.getByTestId("available-biovars")).toHaveTextContent("1,2");
    expect(screen.queryByText("stale warning")).not.toBeInTheDocument();
    await act(async () => { checks[0].reject(new Error("obsolete request failed")); await Promise.resolve(); });
    expect(screen.getByTestId("available-biovars")).toHaveTextContent("1,2");
  });

  it("does not publish an availability response after Data unmounts", async () => {
    let resolveCheck!: (value: { available: number[]; permission_issues: string[] }) => void;
    mocks.search = "tab=climate";
    mocks.apiGet.mockImplementation((url: string) => url.includes("/climate/check?")
      ? new Promise((resolve) => { resolveCheck = resolve; })
      : Promise.resolve({ scenarios: [], uploads: [] }));
    const view = render(<DataPage />);
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    await act(async () => { resolveCheck({ available: [1], permission_issues: [] }); await Promise.resolve(); });
  });

  it("provides real panel targets without mounting inactive scientific controls", async () => {
    const view = render(<DataPage />);
    await act(async () => { await Promise.resolve(); });
    for (const tab of screen.getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls")!)).not.toBeNull();
    }
    expect(screen.getByRole("tabpanel", { name: "Occurrence" })).toHaveTextContent("Upload fixture");
    expect(screen.queryByText("Climate fixture")).not.toBeInTheDocument();
    mocks.search = "tab=climate";
    view.rerender(<DataPage />);
    expect(screen.getByRole("tabpanel", { name: "Climate" })).toHaveTextContent("Climate fixture");
    expect(screen.queryByText("Upload fixture")).not.toBeInTheDocument();
  });

  it("does not navigate Data while moving keyboard focus before explicit activation", async () => {
    render(<DataPage />);
    await act(async () => { await Promise.resolve(); });
    const occurrence = screen.getByRole("tab", { name: "Occurrence" });
    const climate = screen.getByRole("tab", { name: "Climate" });
    act(() => occurrence.focus());
    fireEvent.keyDown(occurrence, { key: "ArrowRight" });
    expect(climate).toHaveFocus();
    expect(mocks.replace).not.toHaveBeenCalled();
    fireEvent.keyDown(climate, { key: "Enter" });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/data?tab=climate", { scroll: false });
  });
});
