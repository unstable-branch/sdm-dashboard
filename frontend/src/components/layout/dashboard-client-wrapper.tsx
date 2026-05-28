"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellHeader } from "@/components/app-shell-header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/toast-wrapper";
import ErrorBoundary from "@/components/ui/error-boundary";

export function DashboardClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
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
    </ToastProvider>
  );
}
