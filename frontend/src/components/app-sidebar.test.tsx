import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";
import { SidebarContext } from "./ui/sidebar";

const useJobSSE = vi.fn();
const current = vi.hoisted(() => ({ pathname: "/results" }));

vi.mock("next/navigation", () => ({ usePathname: () => current.pathname }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
vi.mock("@/hooks/use-job-sse", () => ({
  get useJobSSE() { return useJobSSE; },
}));

describe("AppSidebar", () => {
  it("provides a visible mobile close control", () => {
    useJobSSE.mockReturnValue({ hasActive: false });
    const setOpen = vi.fn();
    render(
      <SidebarContext.Provider value={{ open: true, setOpen }}>
        <AppSidebar />
      </SidebarContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("shows a Reconnect button when the SSE channel has given up", () => {
    useJobSSE.mockReturnValue({
      hasActive: true,
      connected: false,
      connectionGaveUp: true,
      reconnectAttempts: 25,
      reconnectNow: vi.fn(),
    });
    render(
      <SidebarContext.Provider value={{ open: true, setOpen: vi.fn() }}>
        <AppSidebar />
      </SidebarContext.Provider>,
    );
    const btn = screen.getByRole("button", { name: /Reconnect/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
  });

  it("closes the mobile overlay and focuses page content after route navigation", () => {
    current.pathname = "/results";
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    const setOpen = vi.fn();
    const view = render(<SidebarContext.Provider value={{ open: true, setOpen }}><AppSidebar /><main id="workbench-content" tabIndex={-1}>Page</main></SidebarContext.Provider>);
    current.pathname = "/model";
    view.rerender(<SidebarContext.Provider value={{ open: true, setOpen }}><AppSidebar /><main id="workbench-content" tabIndex={-1}>Page</main></SidebarContext.Provider>);
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(screen.getByRole("main"));
    vi.unstubAllGlobals();
  });

  it("leaves the desktop sidebar open on route navigation", () => {
    current.pathname = "/results";
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const setOpen = vi.fn();
    const view = render(<SidebarContext.Provider value={{ open: true, setOpen }}><AppSidebar /></SidebarContext.Provider>);
    current.pathname = "/model";
    view.rerender(<SidebarContext.Provider value={{ open: true, setOpen }}><AppSidebar /></SidebarContext.Provider>);
    expect(setOpen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
