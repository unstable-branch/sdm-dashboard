"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, type User } from "@/stores/auth-store";
import { apiGet, ApiError } from "@/services/api";
import { currentSessionGeneration, isLogoutPending } from "@/services/session-coordinator";
import { Loader2 } from "lucide-react";

interface AuthGuardProps { children: React.ReactNode; redirectTo?: string; }
let restoration: Promise<void> | null = null;

export function AuthGuard({ children, redirectTo = "/login" }: AuthGuardProps) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const setStatus = useAuthStore((s) => s.setStatus);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const restore = useCallback(async () => {
    if (isLogoutPending()) {
      setStatus("unavailable");
      setReady(true);
      return;
    }
    const generationAtStart = currentSessionGeneration();
    if (!restoration) {
      const startedAtGeneration = currentSessionGeneration();
      restoration = apiGet<User>("/api/v1/auth/me").then((user) => {
        if (startedAtGeneration !== currentSessionGeneration() || isLogoutPending()) {
          if (isLogoutPending()) setStatus("unavailable");
          return;
        }
        if (!user?.id) throw new Error("Malformed current-user response");
        setAuth(user);
      }).catch((error: unknown) => {
        if (startedAtGeneration !== currentSessionGeneration()) return;
        if (error instanceof ApiError && error.status === 401) {
          if (isLogoutPending()) setStatus("unavailable");
          else clearAuth();
        } else {
          setStatus("unavailable");
        }
      }).finally(() => { restoration = null; });
    }
    await restoration;
    if (isLogoutPending()) {
      setStatus("unavailable");
      setReady(true);
      return;
    }
    if (generationAtStart !== currentSessionGeneration()) {
      setAttempt((value) => value + 1);
      return;
    }
    setReady(true);
  }, [clearAuth, setAuth, setStatus]);
  useEffect(() => {
    const onPeerSessionChange = () => { setReady(false); setAttempt((value) => value + 1); };
    window.addEventListener("sdm:session-changed", onPeerSessionChange);
    return () => window.removeEventListener("sdm:session-changed", onPeerSessionChange);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void restore(); }, 0);
    return () => window.clearTimeout(timer);
  }, [restore, attempt]);
  useEffect(() => {
    if (status === "signed-out") router.push(redirectTo);
  }, [status, redirectTo, router]);

  if (!ready || status === "unknown") return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /><span className="ml-2 text-sdm-muted">Checking session…</span></div>;
  if (status === "unavailable") return <div className="mx-auto max-w-lg p-6 text-center text-sdm-muted" role="alert"><p>Session status is temporarily unavailable. Your saved profile has not been cleared.</p><button type="button" className="mt-3 rounded-md border px-3 py-2" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>;
  if (status !== "authenticated") return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-sdm-accent" /><span className="ml-2 text-sdm-muted">Redirecting…</span></div>;
  return <>{children}</>;
}
