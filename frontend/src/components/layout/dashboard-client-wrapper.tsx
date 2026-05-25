"use client";

import dynamic from "next/dynamic";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellHeader } from "@/components/app-shell-header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

const ErrorBoundary = dynamic(() => import("@/components/ui/error-boundary").then(m => ({ default: m.ErrorBoundary })));

export function DashboardClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AuthGuard>
        <ErrorBoundary>
          <AppSidebar />
          <SidebarInset>
            <AppShellHeader />
            <main className="flex-1 p-4 sm:p-6">{children}</main>
          </SidebarInset>
        </ErrorBoundary>
      </AuthGuard>
    </SidebarProvider>
  );
}
