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
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const fallback = getAuthToken();
    if (token || fallback) {
      setChecked(true);
    } else {
      router.push(redirectTo);
    }
  }, [token, router, redirectTo]);

  if (!token && !getAuthToken()) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        <span className="ml-2 text-sdm-muted">Checking authentication...</span>
      </div>
    );
  }

  return <>{children}</>;
}
