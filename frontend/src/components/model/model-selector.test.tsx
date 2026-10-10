import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "./model-selector";

const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: { pinnedModelIds: [] }, updateSettings }),
}));
const models = [
  { id: "glm", label: "Logistic regression", maturity: "stable", available: true, min_records: 15, packages: ["stats"] },
  { id: "gam", label: "Smooth response curves", maturity: "experimental", available: true },
  { id: "brms", label: "Bayesian model", maturity: "experimental", available: false, notes: "Requires Stan" },
  { id: "custom", label: "Custom algorithm", maturity: "experimental" },
];
const openCatalog = () => fireEvent.click(screen.getByRole("button", { name: "Change model" }));
beforeEach(() => vi.clearAllMocks());

describe("progressive model picker", () => {
  it("starts with the selected model and requirements rather than the entire catalog", () => {
    render(<ModelSelector models={models} selected="glm" onSelect={vi.fn()} />);
    expect(screen.getByText("Logistic regression")).toBeInTheDocument();
    expect(screen.getByText("≥ 15 records")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change model" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps unavailable and unknown availability discoverable without equating them to maturity", () => {
    render(<ModelSelector models={models} selected="glm" onSelect={vi.fn()} />);
    openCatalog();
    fireEvent.click(screen.getByRole("button", { name: "All models" }));
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByText("Availability not checked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Bayesian model" })).toBeInTheDocument();
  });

  it("offers an available-only filter without losing the current selection", () => {
    render(<ModelSelector models={models} selected="brms" onSelect={vi.fn()} />);
    openCatalog();
    fireEvent.click(screen.getByRole("button", { name: "Available models" }));
    expect(screen.queryByRole("button", { name: "Select Bayesian model" })).not.toBeInTheDocument();
    expect(screen.getByText("Bayesian model")).toBeInTheDocument();
  });

  it("pins using a separate native button without selecting the model", () => {
    const onSelect = vi.fn();
    render(<ModelSelector models={models} selected="glm" onSelect={onSelect} />);
    openCatalog();
    const pin = screen.getByRole("button", { name: "Pin Smooth response curves" });
    expect(pin.parentElement?.closest("button")).toBeNull();
    fireEvent.click(pin);
    expect(onSelect).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({ pinnedModelIds: ["gam"] });
  });

  it("searches hidden sections and describes an empty search result", () => {
    render(<ModelSelector models={models} selected="glm" onSelect={vi.fn()} />);
    openCatalog();
    fireEvent.click(screen.getByRole("button", { name: "All models" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), { target: { value: "Stan" } });
    expect(screen.getByRole("button", { name: "Select Bayesian model" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), { target: { value: "no-match" } });
    expect(screen.getByRole("status")).toHaveTextContent("No models match");
  });

  it("selects by canonical model ID and returns focus to the catalog toggle", () => {
    const onSelect = vi.fn();
    render(<ModelSelector models={models} selected="glm" onSelect={onSelect} />);
    openCatalog();
    fireEvent.click(screen.getByRole("button", { name: "Select Smooth response curves" }));
    expect(onSelect).toHaveBeenCalledWith("gam");
    expect(screen.getByRole("button", { name: "Change model" })).toHaveFocus();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
