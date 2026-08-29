"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { getAuthToken } from "@/services/api";
import { Loader2 } from "lucide-react";

interface AuthGuardProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export function AuthGuard({ children, redirectTo = "/login" }: AuthGuardProps) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  // Wait for Zustand persist hydration before deciding. On first paint the
  // store reads from the SSR snapshot (token=null), which would otherwise
  // bounce a returning user to /login. `hasHydrated` flips true after the
  // localStorage rehydrate completes.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsubFinishHydration = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return () => {
      unsubFinishHydration();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const fallback = getAuthToken();
    if (!token && !fallback) {
      router.push(redirectTo);
    }
  }, [token, router, redirectTo, hydrated]);

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-64" suppressHydrationWarning>
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" suppressHydrationWarning />
        <span className="ml-2 text-sdm-muted">Loading session…</span>
      </div>
    );
  }

  const fallback = typeof window !== "undefined" ? getAuthToken() : null;
  if (!token && !fallback) {
    return (
      <div className="flex items-center justify-center h-64" suppressHydrationWarning>
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" suppressHydrationWarning />
        <span className="ml-2 text-sdm-muted">Redirecting…</span>
      </div>
    );
  }

  return <>{children}</>;
}
