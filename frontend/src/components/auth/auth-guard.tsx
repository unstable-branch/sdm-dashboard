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
  const { token } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const fallback = getAuthToken();
    if (!token && !fallback) {
      router.push(redirectTo);
    } else {
      setChecking(false);
    }
  }, [token, router, redirectTo]);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        <span className="ml-2 text-sdm-muted">Checking authentication...</span>
      </div>
    );
  }

  return <>{children}</>;
}
