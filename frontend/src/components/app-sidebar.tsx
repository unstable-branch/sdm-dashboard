"use client";

import { useContext, useMemo, useEffect, useRef } from "react";
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
  SidebarContext,
} from "@/components/ui/sidebar";
import {
  Leaf,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { pipelineItems, systemItems } from "@/components/dashboard-nav";
import { useAuthStore } from "@/stores/auth-store";
import { useJobSSE } from "@/hooks/use-job-sse";

import { AdminSidebarGroup } from "@/components/layout/admin-sidebar-group";

function ActiveJobDot() {
  const { hasActive, connected, connectionGaveUp, reconnectAttempts, reconnectNow } = useJobSSE(true);
  // When the SSE connection has given up reconnecting (e.g. backend has
  // been unreachable for ~minutes) surface a reconnect button. The job
  // status dot is suppressed in this state to avoid implying jobs are
  // healthy when the channel itself is dead.
  if (!hasActive) return null;
  if (connectionGaveUp) {
    return (
      <button
        type="button"
        onClick={reconnectNow}
        className="ml-auto rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20"
        title={`Realtime channel offline (${reconnectAttempts} reconnect attempts). Click to retry now.`}
      >
        Reconnect
      </button>
    );
  }
  if (!connected) {
    return (
      <span
        className="ml-auto h-2 w-2 rounded-full bg-amber-500 animate-pulse"
        title="Realtime channel reconnecting"
      />
    );
  }
  return (
    <span
      className="ml-auto h-2 w-2 rounded-full bg-green-500 animate-pulse"
      title="Job active"
    />
  );
}

export function AppSidebar() {
  const { open, setOpen } = useContext(SidebarContext);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    if (open && window.matchMedia("(max-width: 767px)").matches) {
      setOpen(false);
      window.requestAnimationFrame(() => document.getElementById("workbench-content")?.focus());
    }
  }, [pathname, open, setOpen]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const navLinkClass = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sdm-muted hover:bg-sdm-surface-soft hover:text-sdm-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sdm-accent transition-colors";

  const systemLinks = useMemo(
    () =>
      systemItems.map((item) => {
        const active = isActive(item.href);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild className="p-0 hover:bg-transparent">
              <Link href={item.href} className={cn(navLinkClass, active && "bg-sdm-accent/10 text-sdm-accent")} aria-current={active ? "page" : undefined}>
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
        <div className="flex items-center gap-3 px-3 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sdm-accent/20 bg-sdm-accent/10">
            <Leaf className="h-5 w-5 text-sdm-accent" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="block text-base font-semibold tracking-tight text-sdm-heading">SDM Dashboard</span>
            <span className="block text-xs text-sdm-muted">Species distribution modelling</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded-md p-1.5 text-sdm-muted hover:bg-sdm-surface-soft hover:text-sdm-text md:hidden"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Pipeline</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pipelineItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild className="p-0 hover:bg-transparent">
                    <Link href={item.href} className={cn(navLinkClass, isActive(item.href) && "bg-sdm-accent/10 text-sdm-accent")} aria-current={isActive(item.href) ? "page" : undefined}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                      {item.href === "/model" && <ActiveJobDot />}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
        <p className="px-3 py-2 text-xs leading-relaxed text-sdm-muted">SDM Dashboard</p>
      </SidebarFooter>
    </Sidebar>
  );
}
