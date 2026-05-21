"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { Loader2 } from "lucide-react";

interface AuthGuardProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export function AuthGuard({ children, redirectTo = "/login" }: AuthGuardProps) {
  const router = useRouter();
  const { token, user } = useAuthStore();

  useEffect(() => {
    if (!token) {
      router.push(redirectTo);
    }
  }, [token, router, redirectTo]);

  if (!token) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
        <span className="ml-2 text-sdm-muted">Checking authentication...</span>
      </div>
    );
  }

  return <>{children}</>;
}
