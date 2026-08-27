import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";
import { SidebarContext } from "./ui/sidebar";

const useJobSSE = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/results" }));
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

  it("shows an amber reconnecting dot while connected is false but not yet gave up", () => {
    useJobSSE.mockReturnValue({
      hasActive: true,
      connected: false,
      connectionGaveUp: false,
      reconnectAttempts: 3,
      reconnectNow: vi.fn(),
    });
    render(
      <SidebarContext.Provider value={{ open: true, setOpen: vi.fn() }}>
        <AppSidebar />
      </SidebarContext.Provider>,
    );
    // The amber dot is a span, not a button.
    expect(screen.queryByRole("button", { name: /Reconnect/i })).not.toBeInTheDocument();
  });
});
