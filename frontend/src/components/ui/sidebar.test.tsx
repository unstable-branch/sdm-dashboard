import { act, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarContext, SidebarProvider } from "./sidebar";

function StateProbe() {
  const { open } = useContext(SidebarContext);
  return <span>{open ? "open" : "closed"}</span>;
}

function matchMedia(matches: boolean) {
  return vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe("SidebarProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("defaults closed on a mobile viewport", async () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    await act(async () => render(<SidebarProvider><StateProbe /></SidebarProvider>));
    expect(screen.getByText("closed")).toBeInTheDocument();
  });

  it("opens automatically on a desktop viewport", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    await act(async () => render(<SidebarProvider><StateProbe /></SidebarProvider>));
    expect(screen.getByText("open")).toBeInTheDocument();
  });
});
