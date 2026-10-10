import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShellHeader } from "./app-shell-header";
import { SidebarContext } from "./ui/sidebar";

const mocks = vi.hoisted(() => ({ pathname: "/model", setTheme: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", setTheme: mocks.setTheme }) }));
vi.mock("@/components/layout/user-menu", () => ({ UserMenu: () => <button>Account</button> }));

describe("workbench header", () => {
  it("provides a skip link to the workbench content", () => {
    render(<AppShellHeader />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#workbench-content");
  });

  it("orients the user on nested routes without showing every navigation item twice", () => {
    mocks.pathname = "/results/run-example";
    render(<AppShellHeader />);
    expect(screen.getByLabelText("Current page")).toHaveTextContent("Results");
    expect(screen.queryByRole("link", { name: "Storage" })).not.toBeInTheDocument();
  });

  it("exposes the mobile navigation state and opens it", () => {
    const setOpen = vi.fn();
    render(<SidebarContext.Provider value={{ open: false, setOpen }}><AppShellHeader /></SidebarContext.Provider>);
    const button = screen.getByRole("button", { name: "Open navigation menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("keeps the theme control available", () => {
    render(<AppShellHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });
});
