"use client";

import { useContext } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronRight, Moon, Sun, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminItems, dashboardNavItems, pipelineItems } from "@/components/dashboard-nav";
import { SidebarContext } from "@/components/ui/sidebar";

import { UserMenu } from "@/components/layout/user-menu";

export function AppShellHeader() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useContext(SidebarContext);
  const currentPage = [...dashboardNavItems, ...adminItems]
    .filter((item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const section = pathname.startsWith("/admin") ? "Administration"
    : pipelineItems.some((item) => item === currentPage) ? "Pipeline" : "Workspace";

  return (
    <header className="sticky top-0 z-30 border-b border-sdm-border bg-sdm-bg/95 backdrop-blur">
      <a href="#workbench-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-sdm-surface focus:px-4 focus:py-3 focus:text-sdm-heading focus:ring-2 focus:ring-sdm-accent">
        Skip to content
      </a>
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sdm-muted hover:bg-sdm-surface-soft hover:text-sdm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent md:hidden"
            aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div aria-label="Current page" className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-sdm-muted sm:inline">{section}</span>
            <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-sdm-muted sm:block" aria-hidden="true" />
            <span className="truncate font-semibold text-sdm-heading">{currentPage?.title || "SDM Dashboard"}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-md border border-sdm-border px-2 py-1 text-xs text-sdm-muted lg:inline">Modern platform beta</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
          <UserMenu />
        </div>
      </div>


    </header>
  );
}
