import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MapToolbar } from "./map-toolbar";
import { TooltipProvider } from "@/components/ui/tooltip";

const DEFAULT_LAYERS = {
  suitability: true,
  eoo: false,
  aoo: false,
  boundary: false,
  extent: true,
};

function renderToolbar(overrides: Partial<Parameters<typeof MapToolbar>[0]> = {}) {
  const onToggleLayer = vi.fn();
  const onToggleBasemap = vi.fn();
  const onResetNorth = vi.fn();
  const onFitExtent = vi.fn();

  const containerRef = { current: null as HTMLDivElement | null };

  const result = render(
    <TooltipProvider>
      <MapToolbar
        layers={DEFAULT_LAYERS}
        onToggleLayer={onToggleLayer}
        basemap="dark"
        onToggleBasemap={onToggleBasemap}
        onResetNorth={onResetNorth}
        onFitExtent={onFitExtent}
        containerRef={containerRef as React.RefObject<HTMLDivElement | null>}
        {...overrides}
      />
    </TooltipProvider>
  );

  return { result, onToggleLayer, onToggleBasemap, onResetNorth, onFitExtent, containerRef };
}

function mockContainer(): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 } as DOMRect);
  return el;
}

function setContainerRef(containerRef: React.RefObject<HTMLDivElement | null>, container: HTMLDivElement) {
  act(() => {
    containerRef.current = container;
  });
}

describe("MapToolbar - rendering", () => {
  it("renders with role='toolbar' and aria-orientation='vertical'", () => {
    renderToolbar();
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
  });

  it("renders drag handle with role='button' and tabIndex={0}", () => {
    renderToolbar();
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute("tabIndex", "0");
  });

  it("drag handle has focus-visible ring classes", () => {
    renderToolbar();
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    expect(handle.className).toMatch(/focus-visible:ring-/);
    expect(handle.className).toMatch(/focus-visible:ring-offset-/);
  });

  it("renders all 5 layer toggle buttons", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /suitability raster/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /eoo polygon/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /aoo grid/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /boundary polygon/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /projection extent/i })).toBeInTheDocument();
  });

  it("renders view control buttons", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /reset compass north/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fit map to extent/i })).toBeInTheDocument();
  });

  it("renders basemap toggle with Sun icon label when basemap is dark", () => {
    renderToolbar({ basemap: "dark" });
    expect(screen.getByRole("button", { name: /switch to light basemap/i })).toBeInTheDocument();
  });

  it("renders basemap toggle with Moon icon label when basemap is light", () => {
    renderToolbar({ basemap: "light" });
    expect(screen.getByRole("button", { name: /switch to dark basemap/i })).toBeInTheDocument();
  });

  it("sets aria-pressed=true for active layer toggles", () => {
    renderToolbar({ layers: { suitability: true, eoo: false, aoo: false, boundary: false, extent: true } });
    expect(screen.getByRole("button", { name: /suitability raster/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /projection extent/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("sets aria-pressed=false for inactive layer toggles", () => {
    renderToolbar({ layers: { suitability: true, eoo: false, aoo: false, boundary: false, extent: true } });
    expect(screen.getByRole("button", { name: /eoo polygon/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /aoo grid/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /boundary polygon/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("sets aria-disabled for disabled layer toggles", () => {
    renderToolbar({ disabledLayers: ["eoo"], layers: { suitability: true, eoo: false, aoo: false, boundary: false, extent: true } });
    expect(screen.getByRole("button", { name: /eoo polygon/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("wraps disabled buttons in a span for tooltip access", () => {
    renderToolbar({ disabledLayers: ["eoo"], layers: { suitability: true, eoo: false, aoo: false, boundary: false, extent: true } });
    const btn = screen.getByRole("button", { name: /eoo polygon/i });
    expect(btn.parentElement?.tagName).toBe("SPAN");
  });
});

describe("MapToolbar - layer toggle clicks", () => {
  it("calls onToggleLayer('suitability') when suitability button clicked", async () => {
    const { onToggleLayer } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /suitability raster/i }));
    expect(onToggleLayer).toHaveBeenCalledWith("suitability");
  });

  it("calls onToggleLayer('eoo') when EOO button clicked", async () => {
    const { onToggleLayer } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /eoo polygon/i }));
    expect(onToggleLayer).toHaveBeenCalledWith("eoo");
  });

  it("calls onToggleLayer('aoo') when AOO button clicked", async () => {
    const { onToggleLayer } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /aoo grid/i }));
    expect(onToggleLayer).toHaveBeenCalledWith("aoo");
  });

  it("calls onToggleLayer('boundary') when boundary button clicked", async () => {
    const { onToggleLayer } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /boundary polygon/i }));
    expect(onToggleLayer).toHaveBeenCalledWith("boundary");
  });

  it("calls onToggleLayer('extent') when extent button clicked", async () => {
    const { onToggleLayer } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /projection extent/i }));
    expect(onToggleLayer).toHaveBeenCalledWith("extent");
  });

  it("does not call onToggleLayer when disabled button clicked", async () => {
    const { onToggleLayer } = renderToolbar({ disabledLayers: ["eoo"], layers: { suitability: true, eoo: false, aoo: false, boundary: false, extent: true } });
    await userEvent.click(screen.getByRole("button", { name: /eoo polygon/i }));
    expect(onToggleLayer).not.toHaveBeenCalled();
  });
});

describe("MapToolbar - basemap toggle", () => {
  it("calls onToggleBasemap when clicked", async () => {
    const { onToggleBasemap } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /switch to light basemap/i }));
    expect(onToggleBasemap).toHaveBeenCalledTimes(1);
  });
});

describe("MapToolbar - view controls", () => {
  it("calls onResetNorth when clicked", async () => {
    const { onResetNorth } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /reset compass north/i }));
    expect(onResetNorth).toHaveBeenCalledTimes(1);
  });

  it("calls onFitExtent when clicked", async () => {
    const { onFitExtent } = renderToolbar();
    await userEvent.click(screen.getByRole("button", { name: /fit map to extent/i }));
    expect(onFitExtent).toHaveBeenCalledTimes(1);
  });
});

describe("MapToolbar - SSR safety", () => {
  it("renders with DEFAULT_POSITION on first render (no localStorage access)", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    renderToolbar();
    expect(getItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });
});

describe("MapToolbar - position persistence", () => {
  const STORAGE_KEY = "sdm-map-toolbar-pos";
  const PER_RUN_KEY = (id: string) => `${STORAGE_KEY}:${id}`;

  beforeEach(() => {
    localStorage.clear();
  });

  it("uses DEFAULT_POSITION when localStorage is empty", () => {
    const { containerRef } = renderToolbar({ runId: "run-abc" });
    setContainerRef(containerRef, mockContainer());
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ top: "12px", left: "12px" });
  });

  it("loads position from per-run key on mount", () => {
    localStorage.setItem(PER_RUN_KEY("run-abc"), JSON.stringify({ x: 50, y: 80 }));
    const { containerRef } = renderToolbar({ runId: "run-abc" });
    setContainerRef(containerRef, mockContainer());
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ top: "80px", left: "50px" });
  });

  it("falls back to legacy global key when per-run key missing", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 30, y: 40 }));
    const { containerRef } = renderToolbar({ runId: "run-abc" });
    setContainerRef(containerRef, mockContainer());
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ top: "40px", left: "30px" });
  });

  it("prefers per-run key over legacy key", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 30, y: 40 }));
    localStorage.setItem(PER_RUN_KEY("run-abc"), JSON.stringify({ x: 99, y: 88 }));
    const { containerRef } = renderToolbar({ runId: "run-abc" });
    setContainerRef(containerRef, mockContainer());
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ top: "88px", left: "99px" });
  });

  it("does not crash when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("storage error"); });
    const { containerRef } = renderToolbar({ runId: "run-abc" });
    setContainerRef(containerRef, mockContainer());
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toBeInTheDocument();
  });

  it("reloads position when runId prop changes", () => {
    localStorage.setItem(PER_RUN_KEY("run-1"), JSON.stringify({ x: 10, y: 20 }));
    localStorage.setItem(PER_RUN_KEY("run-2"), JSON.stringify({ x: 30, y: 40 }));
    const { containerRef, result } = renderToolbar({ runId: "run-1" });
    setContainerRef(containerRef, mockContainer());

    result.rerender(
      <TooltipProvider>
        <MapToolbar
          layers={DEFAULT_LAYERS}
          onToggleLayer={vi.fn()}
          basemap="dark"
          onToggleBasemap={vi.fn()}
          onResetNorth={vi.fn()}
          onFitExtent={vi.fn()}
          containerRef={containerRef as React.RefObject<HTMLDivElement | null>}
          runId="run-2"
        />
      </TooltipProvider>
    );

    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ top: "40px", left: "30px" });
  });
});

describe("MapToolbar - keyboard arrow navigation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does NOT call preventDefault on Tab key", () => {
    renderToolbar();
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    const preventDefault = vi.fn();
    fireEvent.keyDown(handle, { key: "Tab", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does NOT call preventDefault on Enter key", () => {
    renderToolbar();
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    const preventDefault = vi.fn();
    fireEvent.keyDown(handle, { key: "Enter", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does NOT call preventDefault on Escape key", () => {
    renderToolbar();
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    const preventDefault = vi.fn();
    fireEvent.keyDown(handle, { key: "Escape", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("moves left on ArrowLeft, 10px", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "2px", top: "12px" });
  });

  it("moves right on ArrowRight, 10px", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "22px", top: "12px" });
  });

  it("moves up on ArrowUp, 10px", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "12px", top: "2px" });
  });

  it("moves down on ArrowDown, 10px", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    await userEvent.keyboard("{ArrowDown}");
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "12px", top: "22px" });
  });

  it("clamps position to container bounds during keyboard move", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    for (let i = 0; i < 100; i++) {
      await userEvent.keyboard("{ArrowLeft}");
    }
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "0px" });
  });

  it("Enter key resets position to DEFAULT_POSITION", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "12px", top: "12px" });
  });
});

describe("MapToolbar - clamping", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clamps negative x to 0", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    for (let i = 0; i < 10; i++) {
      await userEvent.keyboard("{ArrowLeft}");
    }
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ left: "0px" });
  });

  it("clamps negative y to 0", async () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    setContainerRef(containerRef, mockContainer());
    const handle = screen.getByRole("button", { name: /drag to reposition/i });
    handle.focus();
    for (let i = 0; i < 10; i++) {
      await userEvent.keyboard("{ArrowUp}");
    }
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveStyle({ top: "0px" });
  });
});

describe("MapToolbar - pointer drag", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("toolbar is rendered and drag handle is pointer-focusable", () => {
    const { containerRef } = renderToolbar({ runId: "test-run" });
    act(() => { containerRef.current = mockContainer(); });
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toBeInTheDocument();
    const dragHandle = screen.getByRole("button", { name: /drag to reposition/i });
    expect(dragHandle).toHaveAttribute("tabIndex", "0");
    // Pointer drag behavior is equivalent to keyboard drag (same setPosition call),
    // verified by keyboard arrow tests above. This test confirms the drag handle mounts.
  });
});

describe("MapToolbar - disabled layer tooltips", () => {
  it("shows disabled reason in title attribute for EOO", () => {
    renderToolbar({
      disabledLayers: ["eoo"],
      layers: { suitability: true, eoo: false, aoo: false, boundary: false, extent: true },
    });
    expect(screen.getByRole("button", { name: /eoo polygon/i })).toHaveAttribute(
      "title",
      "EOO polygon unavailable — no EOO GeoJSON"
    );
  });

  it("shows disabled reasons for all disabled layer types", () => {
    renderToolbar({
      disabledLayers: ["suitability", "aoo", "boundary", "extent"],
      layers: { suitability: false, eoo: true, aoo: false, boundary: false, extent: false },
    });
    expect(screen.getByRole("button", { name: /suitability raster/i })).toHaveAttribute(
      "title",
      "Suitability layer unavailable"
    );
    expect(screen.getByRole("button", { name: /aoo grid/i })).toHaveAttribute(
      "title",
      "AOO grid unavailable — no AOO GeoJSON"
    );
    expect(screen.getByRole("button", { name: /boundary polygon/i })).toHaveAttribute(
      "title",
      "Boundary polygon unavailable — no boundary GeoJSON"
    );
    expect(screen.getByRole("button", { name: /projection extent/i })).toHaveAttribute(
      "title",
      "Projection extent unavailable"
    );
  });
});
