"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Mail, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sdm-bg">
        <div className="w-full max-w-md p-8">
          <div className="rounded-lg border border-sdm-border bg-sdm-surface p-8 text-center space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-500/10 p-3">
                <Mail className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-sdm-heading">Check your email</h2>
            <p className="text-sm text-sdm-muted">
              If <strong className="text-sdm-text">{email}</strong> is registered, we sent a password reset link to it.
            </p>
            <p className="text-xs text-sdm-muted">
              The link expires in 1 hour and can only be used once.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-4 py-2 text-sm text-sdm-text hover:bg-sdm-surface-soft/70 transition-colors"
            >
              Back to sign in
            </button>
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
            <h1 className="text-2xl font-bold text-sdm-heading">Forgot password?</h1>
            <p className="text-sm text-sdm-muted mt-1">
              Enter your email and we'll send you a reset link
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-sdm-muted mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-sdm-border bg-sdm-surface-soft px-3 py-2 text-sm text-sdm-text focus:border-sdm-accent focus:outline-none"
                placeholder="you@example.com"
              />
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
                  Sending...
                </span>
              ) : (
                "Send reset link"
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