"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellHeader } from "@/components/app-shell-header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ToastProvider } from "@/components/toast-wrapper";

export function DashboardClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SidebarProvider>
        <AuthGuard>
          <AppSidebar />
          <SidebarInset>
            <AppShellHeader />
            <main id="workbench-content" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-6 lg:p-8">{children}</main>
          </SidebarInset>
        </AuthGuard>
      </SidebarProvider>
    </ToastProvider>
  );
}
