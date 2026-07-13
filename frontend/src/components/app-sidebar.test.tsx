import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";
import { SidebarContext } from "./ui/sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/results" }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }) }));
vi.mock("@/hooks/use-job-sse", () => ({ useJobSSE: () => ({ hasActive: false }) }));

describe("AppSidebar", () => {
  it("provides a visible mobile close control", () => {
    const setOpen = vi.fn();
    render(
      <SidebarContext.Provider value={{ open: true, setOpen }}>
        <AppSidebar />
      </SidebarContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});
