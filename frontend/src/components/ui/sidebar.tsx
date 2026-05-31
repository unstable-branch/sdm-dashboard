"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const SidebarContext = React.createContext<SidebarContextValue>({
  open: true,
  setOpen: () => {},
});

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      <div className="flex min-h-screen w-full min-w-0">{children}</div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open, setOpen } = React.useContext(SidebarContext);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  return (
    <>
      {/* Mobile overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="Main navigation"
        className={cn(
          "flex-col border-r bg-sdm-surface transition-all z-50",
          "fixed inset-y-0 left-0 md:relative md:flex",
          "w-64 shrink-0",
          !open && "-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden",
          open && "translate-x-0",
          className
        )}
      >
        {children}
      </aside>
    </>
  );
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col">{children}</div>;
}

export function SidebarHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b px-2">{children}</div>;
}

export function SidebarContent({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-auto py-2">{children}</div>;
}

export function SidebarFooter({ children }: { children: React.ReactNode }) {
  return <div className="border-t p-2">{children}</div>;
}

export function SidebarGroup({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-2">{children}</div>;
}

export function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-xs font-semibold text-sdm-muted uppercase tracking-wider">
      {children}
    </div>
  );
}

export function SidebarGroupContent({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

export function SidebarMenu({ children }: { children: React.ReactNode }) {
  return <nav className="space-y-1">{children}</nav>;
}

export function SidebarMenuItem({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

export function SidebarMenuButton({
  children,
  asChild,
  className,
}: {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
}) {
  const Comp = asChild ? "div" : "button";
  return (
    <Comp
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sdm-text hover:bg-sdm-surface-soft hover:text-sdm-accent transition-colors",
        className
      )}
    >
      {children}
    </Comp>
  );
}
