"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Leaf,
  Moon,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { pipelineItems, systemItems } from "@/components/dashboard-nav";
import { useAuthStore } from "@/stores/auth-store";

import { AdminSidebarGroup } from "@/components/layout/admin-sidebar-group";

export function AppSidebar() {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const navLinkClass = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft hover:text-sdm-accent transition-colors";

  const pipelineLinks = useMemo(
    () =>
      pipelineItems.map((item) => {
        const active = isActive(item.href);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild className={active ? "bg-sdm-accent/10" : ""}>
              <Link href={item.href} className={cn(navLinkClass, active && "text-sdm-accent")} aria-current={active ? "page" : undefined}>
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      }),
    [pathname]
  );

  const systemLinks = useMemo(
    () =>
      systemItems.map((item) => {
        const active = isActive(item.href);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild className={active ? "bg-sdm-accent/10" : ""}>
              <Link href={item.href} className={cn(navLinkClass, active && "text-sdm-accent")} aria-current={active ? "page" : undefined}>
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      }),
    [pathname]
  );

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-4 py-3">
          <Leaf className="h-6 w-6 text-sdm-accent" aria-hidden="true" />
          <span className="text-lg font-bold text-sdm-heading">SDM Platform</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Pipeline</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pipelineLinks}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemLinks}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin && <AdminSidebarGroup />}
      </SidebarContent>
      <SidebarFooter>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
