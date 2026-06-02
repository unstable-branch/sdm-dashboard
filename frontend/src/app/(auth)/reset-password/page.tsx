"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Lock, ArrowLeft } from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-sdm-bg">
        <Loader2 className="h-6 w-6 animate-spin text-sdm-muted" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Reset token is missing. Please use the link from your email.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sdm-bg">
        <div className="w-full max-w-md p-8">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-500/10 p-3">
                <Lock className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-sdm-heading">Password reset</h2>
            <p className="text-sm text-sdm-muted">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 transition-colors"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sdm-bg">
        <div className="w-full max-w-md p-8">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center space-y-4">
            <h2 className="text-xl font-semibold text-sdm-heading">Invalid link</h2>
            <p className="text-sm text-sdm-muted">
              This password reset link is invalid or has expired.
            </p>
            <Link
              href="/forgot-password"
              className="block w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-4 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft/70 transition-colors"
            >
              Request a new reset link
            </Link>
            <Link
              href="/login"
              className="block text-sm text-sdm-muted hover:text-sdm-text transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sdm-bg">
      <div className="w-full max-w-md p-8">
        <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-sdm-heading">Set new password</h1>
            <p className="text-sm text-sdm-muted mt-1">
              Choose a strong password (at least 8 characters)
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-sdm-muted mb-1">
                New password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sdm-muted" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft pl-9 pr-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-medium text-sdm-muted mb-1">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sdm-muted" />
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft pl-9 pr-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-sdm-accent px-4 py-2 text-sm font-medium text-white hover:bg-sdm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Resetting...
                </span>
              ) : (
                "Reset password"
              )}
            </button>
          </form>

          <div className="text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-sm text-sdm-muted hover:text-sdm-text transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}