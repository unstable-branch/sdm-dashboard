"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { Loader2 } from "lucide-react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user || user.role !== "admin") {
      router.push("/");
    }
  }, [user, router]);

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-sdm-muted">
          <Loader2 className="h-6 w-6 animate-spin text-sdm-accent" />
          <span>Checking permissions...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}