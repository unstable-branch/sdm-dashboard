"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AuthGuard>
        <ErrorBoundary>
          <AppSidebar />
          <SidebarInset>
            <main className="flex-1 p-6">{children}</main>
          </SidebarInset>
        </ErrorBoundary>
      </AuthGuard>
    </SidebarProvider>
  );
}
