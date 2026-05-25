"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellHeader } from "@/components/app-shell-header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { apiGet } from "@/services/api";

const ErrorBoundary = dynamic(() => import("@/components/ui/error-boundary").then(m => ({ default: m.ErrorBoundary })));

export function DashboardClientWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ["sdm-runs"],
      queryFn: () => apiGet<{ runs: unknown[] }>("/api/v1/sdm/runs"),
      staleTime: 30_000,
    });
  }, [queryClient]);

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
