"use client";

export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg border border-sdm-border bg-sdm-surface p-6 animate-pulse ${className}`}
    >
      <div className="h-4 bg-sdm-muted/20 rounded w-3/4 mb-4" />
      <div className="h-3 bg-sdm-muted/20 rounded w-1/2 mb-2" />
      <div className="h-3 bg-sdm-muted/20 rounded w-2/3" />
    </div>
  );
}
