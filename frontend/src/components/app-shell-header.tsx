"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Leaf, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/user-menu";
import { dashboardNavItems } from "@/components/dashboard-nav";
import { cn } from "@/lib/utils";

export function AppShellHeader() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          if (currentScrollY < 10) {
            setVisible(true);
          } else if (currentScrollY > lastScrollY.current + 5) {
            setVisible(false);
          } else if (currentScrollY < lastScrollY.current - 5) {
            setVisible(true);
          }
          lastScrollY.current = currentScrollY;
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-sdm-border bg-sdm-bg/95 backdrop-blur transition-transform duration-300",
        visible ? "translate-y-0" : "-translate-y-full"
      )}
    >
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2 md:hidden">
          <Leaf className="h-5 w-5 shrink-0 text-sdm-accent" />
          <span className="truncate text-sm font-semibold text-sdm-heading">SDM Platform</span>
        </Link>

        <div className="hidden min-w-0 md:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-sdm-muted">SDM Dashboard Workbench</p>
          <p className="truncate text-sm text-sdm-text">Modern platform beta</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
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

      <nav className="flex gap-2 overflow-x-auto border-t border-sdm-border px-4 py-2 md:hidden">
        {dashboardNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-xs font-medium text-sdm-muted",
              isActive(item.href) && "border-sdm-accent/30 bg-sdm-accent/10 text-sdm-accent"
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.title}
          </Link>
        ))}
      </nav>
    </header>
  );
}
