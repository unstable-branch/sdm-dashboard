"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sdm-bg">
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center max-w-md" role="alert">
        <AlertTriangle className="h-10 w-10 mx-auto mb-4 text-red-400" />
        <h2 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h2>
        <p className="text-sm text-sdm-muted mb-6">
          {error.message || "An unexpected error occurred on this page."}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md bg-red-500/20 px-5 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
